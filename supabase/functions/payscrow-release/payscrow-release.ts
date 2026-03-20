/**
 * payscrow-release.ts — Master Accountant
 *
 * FIX: Safe JSON parsing — Payscrow can return empty body or HTML on errors.
 *   Old code: `await settleRes.json()` — throws SyntaxError on empty body.
 *   New code: reads text first, attempts JSON parse, falls back to text error message.
 *
 * ALSO: For force=true (ghost-completed recovery), checks Payscrow transaction
 *   status FIRST via GET /status. If Payscrow already shows "Finalized" or
 *   "Completed", the money was actually settled — we just update our DB and
 *   notify the user. No need to call /broker/settle again.
 *
 * ALL SETTLEMENT SCENARIOS:
 *   release_all      → receiver gets receipt.amount
 *   refund           → sender gets receipt.amount
 *   release_specific → receiver gets X, sender gets remainder
 *
 * WORST-CASE HANDLING:
 *   - Ghost-completed: force=true, checks Payscrow status first
 *   - Empty/HTML Payscrow response: safe parsing, clear error message
 *   - Missing bank details: pending_bank_details status + retry flow
 *   - Double-execution: settling lock (10-min stale timeout)
 *   - Network failure: reverts lock, receipt stays retryable
 *   - Email failure: fire-and-forget, never blocks settlement
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAYSCROW_API_BASE = "https://api.payscrow.net/api/v3/marketplace";
const LOCK_STALE_MS     = 10 * 60 * 1000; // 10 minutes

// ── Safe fetch helper — never throws on bad JSON or empty body ────────────────
async function safeFetch(url: string, options: RequestInit): Promise<{ ok: boolean; status: number; data: any; rawText: string }> {
  try {
    const res     = await fetch(url, options);
    const rawText = await res.text();
    let data: any = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      // Non-JSON response (HTML error page, empty body, etc.)
      data = null;
    }
    return { ok: res.ok, status: res.status, data, rawText };
  } catch (networkErr) {
    throw networkErr; // Re-throw network errors for the caller to handle
  }
}

// ── Check Payscrow transaction status ─────────────────────────────────────────
// Returns: "finalized" | "in_progress" | "pending" | "terminated" | "unknown"
async function checkPayscrowStatus(transactionNumber: string, apiKey: string): Promise<string> {
  try {
    const { ok, data } = await safeFetch(
      `${PAYSCROW_API_BASE}/transactions/${transactionNumber}/status`,
      { method: "GET", headers: { BrokerApiKey: apiKey } }
    );
    if (!ok || !data?.success) return "unknown";
    const statusId = data?.data?.statusId;
    // Payscrow statusId: 1=Pending, 2=InProgress, 3=Completed, 4=Finalized, 5=Terminated
    if (statusId === 4) return "finalized";   // Funds already released
    if (statusId === 3) return "completed";   // Escrow code applied, ready to release
    if (statusId === 2) return "in_progress"; // In escrow, can still settle
    if (statusId === 5) return "terminated";  // Cancelled
    if (statusId === 1) return "pending";     // Not paid yet
    return "unknown";
  } catch {
    return "unknown";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { receiptId, decision, amount, force = false } = body;

    if (!receiptId || !decision) {
      return new Response(
        JSON.stringify({ error: "receiptId and decision are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const payscrowApiKey = Deno.env.get("PAYSCROW_BROKER_API_KEY");
    if (!payscrowApiKey) {
      return new Response(
        JSON.stringify({ error: "Payscrow not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 1. Fetch receipt ──────────────────────────────────────────────────
    const { data: receipt, error: receiptError } = await supabaseAdmin
      .from("receipts").select("*").eq("id", receiptId).single();

    if (receiptError || !receipt) {
      return new Response(
        JSON.stringify({ error: "Receipt not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Idempotency / lock checks ──────────────────────────────────────
    if (receipt.status === "completed" && !force) {
      console.log(`[release] ${receiptId} already completed — skipping`);
      return new Response(
        JSON.stringify({ success: true, message: "Already completed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (receipt.status === "completed" && force) {
      // ── FORCE RECOVERY: check Payscrow status first ──────────────────
      // If Payscrow already finalized the transaction, the money was sent.
      // We just need to ensure our DB reflects reality. No need to settle again.
      const transactionNumber = receipt.payscrow_transaction_number;
      if (transactionNumber) {
        console.log(`[release] Force recovery — checking Payscrow status for ${transactionNumber}`);
        const payscrowStatus = await checkPayscrowStatus(transactionNumber, payscrowApiKey);
        console.log(`[release] Payscrow status for ${transactionNumber}: ${payscrowStatus}`);

        if (payscrowStatus === "finalized") {
          // Payscrow already released the funds — our DB is correct, just outdated.
          // Update DB and notify — no need to call /broker/settle.
          console.log(`[release] Transaction already finalized on Payscrow — confirming DB`);
          await supabaseAdmin.from("receipts").update({
            status:                    "completed",
            settlement_initiated_at:   null,
            pending_bank_party:        null,
            settlement_decision:       null,
            settlement_decision_amount: null,
          }).eq("id", receiptId);
          fireNotification(receiptId, decision);
          return new Response(
            JSON.stringify({
              success: true,
              message: "Payscrow already finalized this transaction. Funds were already sent. DB confirmed.",
              payscrowStatus,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (payscrowStatus === "terminated") {
          return new Response(
            JSON.stringify({
              error: "This transaction was terminated/cancelled on Payscrow. Funds cannot be settled through this transaction. Please contact Payscrow support.",
              payscrowStatus,
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (payscrowStatus === "pending") {
          return new Response(
            JSON.stringify({
              error: "Payscrow shows this transaction as still pending (not paid). The funds may not be in escrow.",
              payscrowStatus,
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (payscrowStatus === "unknown") {
          return new Response(
            JSON.stringify({
              error: "Could not verify transaction status with Payscrow. The transaction may be too old or the number is invalid. Please check the Payscrow dashboard directly for transaction " + transactionNumber,
              payscrowStatus,
              transactionNumber,
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // payscrowStatus === "in_progress" or "completed" → funds are in escrow, proceed to settle
        console.log(`[release] Payscrow status "${payscrowStatus}" — proceeding with force settlement`);
      }
    }

    if (receipt.status === "settling" && receipt.settlement_initiated_at) {
      const lockAge = Date.now() - new Date(receipt.settlement_initiated_at).getTime();
      if (lockAge < LOCK_STALE_MS) {
        console.log(`[release] ${receiptId} lock fresh (${lockAge}ms) — 409`);
        return new Response(
          JSON.stringify({ success: false, error: "Settlement already in progress. Try again in a few minutes." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.log(`[release] Stale lock on ${receiptId} (${lockAge}ms) — retrying`);
    }

    const previousStatus    = receipt.status;
    const transactionNumber = receipt.payscrow_transaction_number;

    // ── 3. Dev/test: no Payscrow transaction number ───────────────────────
    if (!transactionNumber) {
      console.log(`[release] No Payscrow transaction for ${receiptId} — local update only`);
      await supabaseAdmin.from("receipts").update({
        status:                    "completed",
        decision_auto_execute_at:  null,
        settlement_initiated_at:   null,
        pending_bank_party:        null,
        settlement_decision:       null,
        settlement_decision_amount: null,
      }).eq("id", receiptId);
      await cleanupDisputes(supabaseAdmin, receiptId);
      fireNotification(receiptId, decision);
      return new Response(
        JSON.stringify({ success: true, message: "Completed locally (no Payscrow transaction)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 4. Fetch profiles ─────────────────────────────────────────────────
    const { data: senderProfile } = await supabaseAdmin
      .from("profiles")
      .select("bank_code, account_number, account_name")
      .eq("id", receipt.sender_id)
      .single();

    const { data: receiverProfile } = await supabaseAdmin
      .from("profiles")
      .select("bank_code, account_number, account_name")
      .eq("email", receipt.receiver_email)
      .maybeSingle();

    const settleAmount  = Number(receipt.amount);
    const settlements: any[] = [];

    // ── 5. Build settlements + validate bank details ──────────────────────
    if (decision === "release_all") {
      if (!receiverProfile?.bank_code || !receiverProfile?.account_number || !receiverProfile?.account_name) {
        return await handleMissingBank(supabaseAdmin, receiptId, "receiver", decision, null, previousStatus, corsHeaders);
      }
      settlements.push({
        bankCode: receiverProfile.bank_code, accountNumber: receiverProfile.account_number,
        accountName: receiverProfile.account_name, amount: settleAmount,
      });

    } else if (decision === "refund") {
      if (!senderProfile?.bank_code || !senderProfile?.account_number || !senderProfile?.account_name) {
        return await handleMissingBank(supabaseAdmin, receiptId, "sender", decision, null, previousStatus, corsHeaders);
      }
      settlements.push({
        bankCode: senderProfile.bank_code, accountNumber: senderProfile.account_number,
        accountName: senderProfile.account_name, amount: settleAmount,
      });

    } else if (decision === "release_specific") {
      const releaseAmt = Math.min(Math.max(0, Number(amount || receipt.sender_decision_amount || 0)), settleAmount);
      const refundAmt  = settleAmount - releaseAmt;

      if (releaseAmt <= 0 && refundAmt <= 0) {
        return new Response(
          JSON.stringify({ error: "Invalid release amount — cannot be zero" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const needsReceiver   = releaseAmt > 0;
      const needsSender     = refundAmt  > 0;
      const missingReceiver = needsReceiver && (!receiverProfile?.bank_code || !receiverProfile?.account_number || !receiverProfile?.account_name);
      const missingSender   = needsSender   && (!senderProfile?.bank_code   || !senderProfile?.account_number   || !senderProfile?.account_name);

      if (missingReceiver || missingSender) {
        const party = (missingReceiver && missingSender) ? "both" : missingReceiver ? "receiver" : "sender";
        return await handleMissingBank(supabaseAdmin, receiptId, party, decision, releaseAmt, previousStatus, corsHeaders);
      }

      if (needsReceiver) settlements.push({ bankCode: receiverProfile!.bank_code, accountNumber: receiverProfile!.account_number, accountName: receiverProfile!.account_name, amount: releaseAmt });
      if (needsSender)   settlements.push({ bankCode: senderProfile!.bank_code,   accountNumber: senderProfile!.account_number,   accountName: senderProfile!.account_name,   amount: refundAmt });

    } else {
      return new Response(
        JSON.stringify({ error: `Unknown decision: "${decision}". Must be release_all, refund, or release_specific.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (settlements.length === 0) {
      return new Response(
        JSON.stringify({ error: "No valid settlement destinations" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify total = settleAmount (Payscrow requires exact match)
    const total = settlements.reduce((s, x) => s + Number(x.amount), 0);
    if (Math.abs(total - settleAmount) > 0.01) {
      return new Response(
        JSON.stringify({ error: `Settlement total ₦${total} does not equal receipt amount ₦${settleAmount}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 6. Acquire settling lock ──────────────────────────────────────────
    if (previousStatus !== "completed") {
      const { error: lockError } = await supabaseAdmin
        .from("receipts")
        .update({
          status:                    "settling",
          settlement_initiated_at:   new Date().toISOString(),
          pending_bank_party:        null,
          settlement_decision:       decision,
          settlement_decision_amount: amount ? Number(amount) : null,
        })
        .eq("id", receiptId)
        .in("status", ["active", "dispute", "unresolved", "pending_bank_details"]);

      if (lockError) {
        return new Response(
          JSON.stringify({ error: "Could not acquire settlement lock. Please try again." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    console.log(`[release] ${receiptId}: decision=${decision} settleAmount=₦${settleAmount} force=${force}`, JSON.stringify(settlements));

    // ── 7. Call Payscrow /broker/settle — SAFE JSON PARSING ───────────────
    let payscrowSuccess = false;
    let errorMessage    = "Settlement failed on Payscrow";
    let settleData: any = null;

    try {
      const { ok, status: httpStatus, data, rawText } = await safeFetch(
        `${PAYSCROW_API_BASE}/transactions/${transactionNumber}/broker/settle`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json", BrokerApiKey: payscrowApiKey },
          body:    JSON.stringify({ settlements }),
        }
      );

      settleData = data;
      console.log(`[release] Payscrow settle HTTP ${httpStatus}:`, rawText.slice(0, 500));

      if (ok && data?.success) {
        payscrowSuccess = true;
      } else if (!data && rawText.trim() === "") {
        // Empty body — Payscrow gave us nothing. Transaction may be expired or invalid.
        errorMessage = `Payscrow returned an empty response (HTTP ${httpStatus}). The transaction may be expired or already settled. Check the Payscrow dashboard for transaction ${transactionNumber}.`;
      } else if (!data) {
        // Non-JSON (HTML error page etc.)
        errorMessage = `Payscrow returned an unexpected response (HTTP ${httpStatus}). Check the Payscrow dashboard for transaction ${transactionNumber}.`;
      } else {
        // Proper JSON error from Payscrow
        errorMessage = data?.message ||
          (Array.isArray(data?.errors) ? data.errors.join(", ") : data?.errors) ||
          `Payscrow settlement failed (HTTP ${httpStatus})`;
      }
    } catch (networkErr) {
      console.error("[release] Network error calling Payscrow:", networkErr);
      if (previousStatus !== "completed") await revertLock(supabaseAdmin, receiptId, previousStatus);
      return new Response(
        JSON.stringify({ error: "Network error reaching Payscrow. Please try again." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!payscrowSuccess) {
      console.error(`[release] Payscrow settle failed: ${errorMessage}`);
      if (previousStatus !== "completed") await revertLock(supabaseAdmin, receiptId, previousStatus);
      return new Response(
        JSON.stringify({ error: errorMessage, payscrowResponse: settleData }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 8. SUCCESS — update DB to completed ──────────────────────────────
    await supabaseAdmin.from("receipts").update({
      status:                    "completed",
      decision_auto_execute_at:  null,
      settlement_initiated_at:   null,
      pending_bank_party:        null,
      settlement_decision:       null,
      settlement_decision_amount: null,
    }).eq("id", receiptId);

    await cleanupDisputes(supabaseAdmin, receiptId);
    fireNotification(receiptId, decision);

    return new Response(
      JSON.stringify({
        success: true, decision, settlements: settlements.length,
        settledAmount: settleAmount, transactionNumber, force,
        message: "Settlement executed via Payscrow. Funds are being sent to bank accounts.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[release] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function revertLock(supabaseAdmin: ReturnType<typeof createClient>, receiptId: string, previousStatus: string) {
  try {
    await supabaseAdmin.from("receipts").update({
      status:                    previousStatus,
      settlement_initiated_at:   null,
      settlement_decision:       null,
      settlement_decision_amount: null,
    }).eq("id", receiptId);
    console.log(`[release] Reverted ${receiptId} → "${previousStatus}"`);
  } catch (e) {
    console.error(`[release] CRITICAL: Failed to revert lock for ${receiptId}:`, e);
  }
}

async function handleMissingBank(
  supabaseAdmin: ReturnType<typeof createClient>,
  receiptId: string,
  missingParty: string,
  decision: string,
  decisionAmount: number | null,
  previousStatus: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  console.log(`[release] ${receiptId}: bank missing for "${missingParty}"`);
  if (previousStatus !== "completed") {
    await supabaseAdmin.from("receipts").update({
      status:                    "pending_bank_details",
      pending_bank_party:        missingParty,
      settlement_decision:       decision,
      settlement_decision_amount: decisionAmount,
      settlement_initiated_at:   null,
    }).eq("id", receiptId);
  }
  fireNotification(receiptId, `missing_bank_${missingParty}`);
  const messages: Record<string, string> = {
    sender:   "The sender must add their bank account in Settings → Bank Details before the refund can be processed.",
    receiver: "The receiver must add their bank account in Settings → Bank Details before payment can be sent.",
    both:     "Both the sender and receiver need to add bank details in Settings before settlement can proceed.",
  };
  return new Response(
    JSON.stringify({ error: messages[missingParty] || "Bank details missing", pendingBankParty: missingParty, requiresBankDetails: true }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function cleanupDisputes(supabaseAdmin: ReturnType<typeof createClient>, receiptId: string) {
  try {
    const { data: disputes } = await supabaseAdmin.from("disputes").select("id").eq("receipt_id", receiptId);
    if (!disputes?.length) return;
    for (const d of disputes) {
      const { data: files } = await supabaseAdmin.from("evidence").select("id, file_path").eq("dispute_id", d.id).neq("file_path", "/placeholder.svg");
      if (files?.length) {
        try { await supabaseAdmin.storage.from("evidence").remove(files.map((f: any) => f.file_path)); } catch { /* best effort */ }
        for (const f of files) await supabaseAdmin.from("evidence").update({ file_path: "/placeholder.svg" }).eq("id", f.id);
      }
      await supabaseAdmin.from("disputes").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", d.id);
    }
  } catch (e) {
    console.error("[release] Cleanup error (non-fatal):", e);
  }
}

function fireNotification(receiptId: string, notificationType: string) {
  fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    body: JSON.stringify({ type: notificationType, receiptId }),
  }).catch((e) => console.error("[release] Email failed:", e));
}