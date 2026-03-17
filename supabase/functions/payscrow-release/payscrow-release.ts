/**
 * payscrow-release.ts — Master Accountant
 *
 * FIXES IN THIS VERSION:
 *
 * GHOST-COMPLETED RECOVERY:
 *   The old code (before the settlement safety migration) could flip a receipt to
 *   "completed" in the DB without ever calling Payscrow's /broker/settle.
 *   This left money stuck in Payscrow escrow with no way to release it.
 *
 *   FIX: Accept a `force: true` flag that bypasses the "already completed" early
 *   return and re-attempts Payscrow settlement. Only admin should call this.
 *   The receipt must still have a valid payscrow_transaction_number.
 *
 *   Normal flow (force: false / omitted):
 *     - Already completed → return early (idempotent, safe)
 *   Recovery flow (force: true):
 *     - Already completed → attempt Payscrow settle anyway
 *     - If Payscrow says already settled → that's fine, return success
 *     - If Payscrow settles successfully → money is now on its way
 *
 * OPERATION ORDER (correct, prevents ghost-completed):
 *   1. Idempotency check (skip if already completed, unless force=true)
 *   2. Validate bank details (before acquiring lock)
 *   3. Acquire "settling" lock
 *   4. Call Payscrow /broker/settle
 *   5. On SUCCESS → update DB to completed, cleanup, notify
 *   6. On FAILURE → revert lock to previous status, return error
 *
 * MISSING BANK DETAILS:
 *   Sets receipt to "pending_bank_details" with which party is missing.
 *   ReceiptView shows retry button. Admin can force-settle once party adds details.
 *
 * EVIDENCE CLEANUP:
 *   On completion, storage files are deleted and DB paths set to /placeholder.svg.
 *   Cleanup failure never blocks settlement success.
 *
 * EMAIL: Always fire-and-forget. Never blocks settlement.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAYSCROW_API_BASE = "https://api.payscrow.net/api/v3/marketplace";
const LOCK_STALE_MS     = 10 * 60 * 1000; // 10 minutes

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { receiptId, decision, amount, force = false } = body;

    if (!receiptId || !decision) {
      return new Response(JSON.stringify({ error: "receiptId and decision are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const payscrowApiKey = Deno.env.get("PAYSCROW_BROKER_API_KEY");
    if (!payscrowApiKey) {
      return new Response(JSON.stringify({ error: "Payscrow not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 1. Fetch receipt ──────────────────────────────────────────────────
    const { data: receipt, error: receiptError } = await supabaseAdmin
      .from("receipts").select("*").eq("id", receiptId).single();

    if (receiptError || !receipt) {
      return new Response(JSON.stringify({ error: "Receipt not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 2. Idempotency checks ─────────────────────────────────────────────
    if (receipt.status === "completed" && !force) {
      // Already completed and not forced — safe early return
      console.log(`[release] Receipt ${receiptId} already completed — skipping (use force=true to re-attempt)`);
      return new Response(JSON.stringify({ success: true, message: "Already completed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (receipt.status === "completed" && force) {
      // Force mode: admin is recovering a ghost-completed receipt
      // We will attempt Payscrow settle again. If already settled there, it will
      // return an error which we handle gracefully.
      console.log(`[release] FORCE mode: re-attempting settlement for ghost-completed receipt ${receiptId}`);
    }

    if (receipt.status === "settling" && receipt.settlement_initiated_at) {
      const lockAge = Date.now() - new Date(receipt.settlement_initiated_at).getTime();
      if (lockAge < LOCK_STALE_MS) {
        console.log(`[release] Receipt ${receiptId} already settling (lock age: ${lockAge}ms)`);
        return new Response(JSON.stringify({ success: false, error: "Settlement already in progress" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.log(`[release] Stale lock on ${receiptId} (${lockAge}ms) — allowing retry`);
    }

    const previousStatus     = receipt.status;
    const transactionNumber  = receipt.payscrow_transaction_number;

    // ── 3. Dev/test: no Payscrow transaction ──────────────────────────────
    if (!transactionNumber) {
      console.log(`[release] No Payscrow transaction for ${receiptId} — local update only`);
      await supabaseAdmin.from("receipts").update({
        status: "completed",
        decision_auto_execute_at: null,
        settlement_initiated_at:  null,
        pending_bank_party:       null,
        settlement_decision:      null,
        settlement_decision_amount: null,
      }).eq("id", receiptId);
      await cleanupDisputes(supabaseAdmin, receiptId);
      fireNotification(receiptId, decision);
      return new Response(JSON.stringify({ success: true, message: "Completed locally (no Payscrow transaction)" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 4. Fetch profiles ─────────────────────────────────────────────────
    const { data: senderProfile }   = await supabaseAdmin.from("profiles").select("*").eq("id", receipt.sender_id).single();
    const { data: receiverProfile } = await supabaseAdmin.from("profiles").select("*").eq("email", receipt.receiver_email).maybeSingle();

    const settleAmount = Number(receipt.amount);
    const settlements:  any[] = [];

    // ── 5. Validate bank details + build settlements array ────────────────
    if (decision === "release_all") {
      if (!receiverProfile?.bank_code || !receiverProfile?.account_number || !receiverProfile?.account_name) {
        return await handleMissingBank(supabaseAdmin, receiptId, "receiver", decision, null, previousStatus, corsHeaders);
      }
      settlements.push({ bankCode: receiverProfile.bank_code, accountNumber: receiverProfile.account_number, accountName: receiverProfile.account_name, amount: settleAmount });

    } else if (decision === "refund") {
      if (!senderProfile?.bank_code || !senderProfile?.account_number || !senderProfile?.account_name) {
        return await handleMissingBank(supabaseAdmin, receiptId, "sender", decision, null, previousStatus, corsHeaders);
      }
      settlements.push({ bankCode: senderProfile.bank_code, accountNumber: senderProfile.account_number, accountName: senderProfile.account_name, amount: settleAmount });

    } else if (decision === "release_specific") {
      const releaseAmt = Math.min(Math.max(0, Number(amount || receipt.sender_decision_amount || 0)), settleAmount);
      const refundAmt  = settleAmount - releaseAmt;

      if (releaseAmt <= 0 && refundAmt <= 0) {
        return new Response(JSON.stringify({ error: "Invalid release amount" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const needsReceiver = releaseAmt > 0;
      const needsSender   = refundAmt  > 0;
      const missingReceiver = needsReceiver && (!receiverProfile?.bank_code || !receiverProfile?.account_number || !receiverProfile?.account_name);
      const missingSender   = needsSender   && (!senderProfile?.bank_code   || !senderProfile?.account_number   || !senderProfile?.account_name);

      if (missingReceiver || missingSender) {
        const party = missingReceiver && missingSender ? "both" : missingReceiver ? "receiver" : "sender";
        return await handleMissingBank(supabaseAdmin, receiptId, party, decision, releaseAmt, previousStatus, corsHeaders);
      }

      if (needsReceiver) settlements.push({ bankCode: receiverProfile!.bank_code, accountNumber: receiverProfile!.account_number, accountName: receiverProfile!.account_name, amount: releaseAmt });
      if (needsSender)   settlements.push({ bankCode: senderProfile!.bank_code,   accountNumber: senderProfile!.account_number,   accountName: senderProfile!.account_name,   amount: refundAmt });

    } else {
      return new Response(JSON.stringify({ error: `Unknown decision: ${decision}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 6. Acquire settling lock ──────────────────────────────────────────
    // Only lock if not already completed (force mode skips the lock update on completed receipts)
    if (receipt.status !== "completed") {
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
        console.error(`[release] Failed to acquire lock for ${receiptId}:`, lockError);
        return new Response(JSON.stringify({ error: "Could not acquire settlement lock. Try again." }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    console.log(`[release] Settling receipt ${receiptId}: decision=${decision} amount=₦${settleAmount} force=${force}`);

    // ── 7. Call Payscrow /broker/settle ───────────────────────────────────
    let settleData: any = null;
    let payscrowSuccess = false;

    try {
      const settleRes = await fetch(
        `${PAYSCROW_API_BASE}/transactions/${transactionNumber}/broker/settle`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json", BrokerApiKey: payscrowApiKey },
          body:    JSON.stringify({ settlements }),
        }
      );
      settleData      = await settleRes.json();
      payscrowSuccess = settleRes.ok && settleData.success;

      // In force mode, if Payscrow says already finalized/settled, that's actually OK —
      // it means the original settlement did go through despite the DB not showing it.
      if (!payscrowSuccess && force) {
        const errText = JSON.stringify(settleData).toLowerCase();
        if (errText.includes("finalized") || errText.includes("already") || errText.includes("completed")) {
          console.log(`[release] Force mode: Payscrow says already settled — marking DB as completed`);
          payscrowSuccess = true;
        }
      }

      console.log("[release] Payscrow settle response:", JSON.stringify(settleData));
    } catch (networkError) {
      console.error("[release] Network error calling Payscrow:", networkError);
      if (receipt.status !== "completed") await revertLock(supabaseAdmin, receiptId, previousStatus);
      return new Response(JSON.stringify({ error: "Network error reaching Payscrow. Please try again." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!payscrowSuccess) {
      const errorMsg =
        settleData?.message ||
        (Array.isArray(settleData?.errors) ? settleData.errors.join(", ") : settleData?.errors) ||
        "Settlement failed on Payscrow";
      console.error("[release] Payscrow settle failed:", JSON.stringify(settleData));
      if (receipt.status !== "completed") await revertLock(supabaseAdmin, receiptId, previousStatus);
      return new Response(
        JSON.stringify({ error: typeof errorMsg === "string" ? errorMsg : JSON.stringify(errorMsg), payscrowResponse: settleData }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 8. Success — update DB to completed ──────────────────────────────
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
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function revertLock(supabaseAdmin: ReturnType<typeof createClient>, receiptId: string, previousStatus: string) {
  try {
    await supabaseAdmin.from("receipts").update({
      status:                  previousStatus,
      settlement_initiated_at: null,
      settlement_decision:     null,
      settlement_decision_amount: null,
    }).eq("id", receiptId);
    console.log(`[release] Reverted ${receiptId} to "${previousStatus}"`);
  } catch (e) {
    console.error(`[release] CRITICAL: Failed to revert lock for ${receiptId}:`, e);
    // Receipt stuck in "settling" — stale lock (10 min) allows retry
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
  console.log(`[release] Receipt ${receiptId}: missing bank for ${missingParty}`);

  // Only update status if not already completed (don't overwrite completed state)
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
    both:     "Both the sender and receiver need to add their bank details in Settings before settlement can proceed.",
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
      const { data: evidenceFiles } = await supabaseAdmin.from("evidence").select("id, file_path").eq("dispute_id", d.id).neq("file_path", "/placeholder.svg");
      if (evidenceFiles?.length) {
        try { await supabaseAdmin.storage.from("evidence").remove(evidenceFiles.map((e: any) => e.file_path)); } catch { /* best effort */ }
        for (const ev of evidenceFiles) {
          await supabaseAdmin.from("evidence").update({ file_path: "/placeholder.svg" }).eq("id", ev.id);
        }
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
  }).catch((e) => console.error("[release] Notification failed:", e));
}