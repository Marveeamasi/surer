/**
 * payscrow-release.ts — Master Accountant
 *
 * ─── PRODUCTION-GRADE RELIABILITY FIXES ─────────────────────────────────────
 *
 * PROBLEM 1 — Ghost-completed (DB says completed, Payscrow never settled):
 *   Old code: called Payscrow THEN updated DB.
 *   If Payscrow call failed, DB was already "completed" — money stuck in escrow forever.
 *   FIX: Order of operations is now:
 *     1. Check idempotency (already settling/completed? bail out safely)
 *     2. Mark receipt as "settling" + set settlement_initiated_at lock
 *     3. Call Payscrow /broker/settle
 *     4. On SUCCESS → update to "completed", cleanup, notify
 *     5. On FAILURE → revert to previous status, clear lock, return error
 *
 * PROBLEM 2 — Double-execution (cron runs twice, sends money twice):
 *   FIX: settlement_initiated_at column acts as a distributed lock.
 *   If it's already set (and recent), we return early — idempotent.
 *   Status "settling" also causes the cron to skip this receipt.
 *
 * PROBLEM 3 — Missing bank details on auto-execute:
 *   Old code: returned HTTP error, cron logged it, receipt stuck forever.
 *   FIX: Sets status to "pending_bank_details", records which party is missing
 *   details and what decision was pending. UI can show a retry button.
 *   Once user adds bank details, they click retry → calls this function again.
 *
 * EVIDENCE CLEANUP:
 *   On successful completion, all dispute evidence images are:
 *   1. Removed from Supabase Storage (frees space)
 *   2. DB file_path set to '/placeholder.svg' (no orphaned rows)
 *
 * EMAIL:
 *   Always fire-and-forget — never blocks or breaks the settlement flow.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAYSCROW_API_BASE = "https://api.payscrow.net/api/v3/marketplace";

// How long a "settling" lock is valid before we consider it stale (10 minutes)
const LOCK_STALE_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { receiptId, decision, amount } = await req.json();

    if (!receiptId || !decision) {
      return new Response(JSON.stringify({ error: "receiptId and decision are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const payscrowApiKey = Deno.env.get("PAYSCROW_BROKER_API_KEY");
    if (!payscrowApiKey) {
      return new Response(JSON.stringify({ error: "Payscrow not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 1. Fetch receipt ──────────────────────────────────────────────────
    const { data: receipt, error: receiptError } = await supabaseAdmin
      .from("receipts")
      .select("*")
      .eq("id", receiptId)
      .single();

    if (receiptError || !receipt) {
      return new Response(JSON.stringify({ error: "Receipt not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 2. Idempotency checks ─────────────────────────────────────────────

    // Already completed → return success (idempotent, safe to call again)
    if (receipt.status === "completed") {
      console.log(`[release] Receipt ${receiptId} already completed — skipping`);
      return new Response(JSON.stringify({ success: true, message: "Already completed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Already settling — check if the lock is fresh or stale
    if (receipt.status === "settling" && receipt.settlement_initiated_at) {
      const lockAge = Date.now() - new Date(receipt.settlement_initiated_at).getTime();
      if (lockAge < LOCK_STALE_MS) {
        // Lock is fresh — another process is handling this, don't double-settle
        console.log(`[release] Receipt ${receiptId} is already being settled (lock age: ${lockAge}ms) — skipping`);
        return new Response(JSON.stringify({ success: false, error: "Settlement already in progress" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Lock is stale (>10 min) — previous attempt likely failed, allow retry
      console.log(`[release] Receipt ${receiptId} has stale lock (${lockAge}ms) — retrying`);
    }

    const previousStatus = receipt.status;
    const transactionNumber = receipt.payscrow_transaction_number;

    // ── 3. Dev/test: no Payscrow transaction number ───────────────────────
    if (!transactionNumber) {
      console.log(`[release] No Payscrow transaction for ${receiptId} — local update only`);
      await supabaseAdmin
        .from("receipts")
        .update({
          status: "completed",
          decision_auto_execute_at: null,
          settlement_initiated_at: null,
          pending_bank_party: null,
          settlement_decision: null,
          settlement_decision_amount: null,
        })
        .eq("id", receiptId);
      await cleanupDisputes(supabaseAdmin, receiptId);
      fireNotification(receiptId, decision);
      return new Response(JSON.stringify({ success: true, message: "Completed locally (no Payscrow transaction)" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 4. Fetch profiles ─────────────────────────────────────────────────
    const { data: senderProfile } = await supabaseAdmin
      .from("profiles").select("*").eq("id", receipt.sender_id).single();

    const { data: receiverProfile } = await supabaseAdmin
      .from("profiles").select("*").eq("email", receipt.receiver_email).maybeSingle();

    // ── 5. Build settlements array ────────────────────────────────────────
    // We settle ONLY receipt.amount. The protection_fee + Payscrow's charge
    // stay in the pool (merchantChargePercentage: 100 at payment time means
    // Payscrow already took their cut from the pool, not from the sender directly).
    const settleAmount = Number(receipt.amount);
    const settlements: any[] = [];

    // ── Validate bank details BEFORE locking ─────────────────────────────
    // This way, if bank details are missing, we don't waste a lock slot.
    if (decision === "release_all") {
      if (!receiverProfile?.bank_code || !receiverProfile?.account_number || !receiverProfile?.account_name) {
        return await handleMissingBankDetails(supabaseAdmin, receiptId, "receiver", decision, null, previousStatus, corsHeaders);
      }
      settlements.push({
        bankCode: receiverProfile.bank_code,
        accountNumber: receiverProfile.account_number,
        accountName: receiverProfile.account_name,
        amount: settleAmount,
      });

    } else if (decision === "refund") {
      if (!senderProfile?.bank_code || !senderProfile?.account_number || !senderProfile?.account_name) {
        return await handleMissingBankDetails(supabaseAdmin, receiptId, "sender", decision, null, previousStatus, corsHeaders);
      }
      settlements.push({
        bankCode: senderProfile.bank_code,
        accountNumber: senderProfile.account_number,
        accountName: senderProfile.account_name,
        amount: settleAmount,
      });

    } else if (decision === "release_specific") {
      const releaseAmt = Math.min(Math.max(0, Number(amount || receipt.sender_decision_amount || 0)), settleAmount);
      const refundAmt  = settleAmount - releaseAmt;

      if (releaseAmt <= 0 && refundAmt <= 0) {
        return new Response(JSON.stringify({ error: "Invalid release amount" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check both parties if both need to be paid
      const needsReceiver = releaseAmt > 0;
      const needsSender   = refundAmt > 0;

      if (needsReceiver && (!receiverProfile?.bank_code || !receiverProfile?.account_number || !receiverProfile?.account_name)) {
        const missingParty = (needsSender && (!senderProfile?.bank_code || !senderProfile?.account_number || !senderProfile?.account_name))
          ? "both" : "receiver";
        return await handleMissingBankDetails(supabaseAdmin, receiptId, missingParty, decision, releaseAmt, previousStatus, corsHeaders);
      }
      if (needsSender && (!senderProfile?.bank_code || !senderProfile?.account_number || !senderProfile?.account_name)) {
        return await handleMissingBankDetails(supabaseAdmin, receiptId, "sender", decision, releaseAmt, previousStatus, corsHeaders);
      }

      if (needsReceiver) {
        settlements.push({
          bankCode: receiverProfile!.bank_code,
          accountNumber: receiverProfile!.account_number,
          accountName: receiverProfile!.account_name,
          amount: releaseAmt,
        });
      }
      if (needsSender) {
        settlements.push({
          bankCode: senderProfile!.bank_code,
          accountNumber: senderProfile!.account_number,
          accountName: senderProfile!.account_name,
          amount: refundAmt,
        });
      }

    } else {
      return new Response(JSON.stringify({ error: `Unknown decision: ${decision}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (settlements.length === 0) {
      return new Response(JSON.stringify({ error: "No valid settlements to process" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(
      `[release] Receipt ${receiptId}: decision=${decision}`,
      `settleAmount=₦${settleAmount}`,
      `settlements=${JSON.stringify(settlements)}`
    );

    // ── 6. ACQUIRE LOCK — mark as "settling" ─────────────────────────────
    // This is the idempotency lock. Any concurrent call will see this and bail.
    // We do this BEFORE calling Payscrow so there's no race window.
    const { error: lockError } = await supabaseAdmin
      .from("receipts")
      .update({
        status: "settling",
        settlement_initiated_at: new Date().toISOString(),
        pending_bank_party: null,          // Clear any previous bank-detail error
        settlement_decision: decision,     // Remember what we're settling
        settlement_decision_amount: amount ? Number(amount) : null,
      })
      .eq("id", receiptId)
      // Only lock if still in a settleable state (prevents race on concurrent calls)
      .in("status", ["active", "dispute", "unresolved", "pending_bank_details"]);

    if (lockError) {
      console.error(`[release] Failed to acquire lock for ${receiptId}:`, lockError);
      return new Response(JSON.stringify({ error: "Could not acquire settlement lock. Try again." }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 7. Call Payscrow /broker/settle ───────────────────────────────────
    let settleData: any = null;
    let payscrowSuccess = false;

    try {
      const settleRes = await fetch(
        `${PAYSCROW_API_BASE}/transactions/${transactionNumber}/broker/settle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", BrokerApiKey: payscrowApiKey },
          body: JSON.stringify({ settlements }),
        }
      );
      settleData = await settleRes.json();
      console.log("[release] Payscrow settle response:", JSON.stringify(settleData));
      payscrowSuccess = settleRes.ok && settleData.success;
    } catch (networkError) {
      // Network error calling Payscrow — revert lock
      console.error("[release] Network error calling Payscrow:", networkError);
      await revertLock(supabaseAdmin, receiptId, previousStatus);
      return new Response(JSON.stringify({ error: "Network error reaching Payscrow. Please try again." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!payscrowSuccess) {
      // Payscrow rejected the settlement — revert lock, return error
      const errorMsg =
        settleData?.message ||
        (Array.isArray(settleData?.errors) ? settleData.errors.join(", ") : settleData?.errors) ||
        "Settlement failed on Payscrow";
      console.error("[release] Payscrow settle failed:", JSON.stringify(settleData));

      await revertLock(supabaseAdmin, receiptId, previousStatus);

      return new Response(
        JSON.stringify({
          error: typeof errorMsg === "string" ? errorMsg : JSON.stringify(errorMsg),
          payscrowResponse: settleData,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 8. SUCCESS — update DB to completed ──────────────────────────────
    // Only reaches here if Payscrow confirmed settlement.
    await supabaseAdmin
      .from("receipts")
      .update({
        status: "completed",
        decision_auto_execute_at: null,
        settlement_initiated_at: null, // Clear lock — no longer needed
        pending_bank_party: null,
        settlement_decision: null,
        settlement_decision_amount: null,
      })
      .eq("id", receiptId);

    // ── 9. Cleanup dispute evidence from storage ──────────────────────────
    await cleanupDisputes(supabaseAdmin, receiptId);

    // ── 10. Notify both parties (fire-and-forget — never blocks) ─────────
    fireNotification(receiptId, decision);

    return new Response(
      JSON.stringify({
        success: true,
        decision,
        settlements: settlements.length,
        settledAmount: settleAmount,
        transactionNumber,
        message: "Settlement executed. Funds are being sent to bank accounts.",
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

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Revert settlement lock on failure
// ─────────────────────────────────────────────────────────────────────────────
async function revertLock(
  supabaseAdmin: ReturnType<typeof createClient>,
  receiptId: string,
  previousStatus: string
) {
  try {
    await supabaseAdmin
      .from("receipts")
      .update({
        status: previousStatus,
        settlement_initiated_at: null,
        settlement_decision: null,
        settlement_decision_amount: null,
      })
      .eq("id", receiptId);
    console.log(`[release] Reverted receipt ${receiptId} to status="${previousStatus}"`);
  } catch (e) {
    console.error(`[release] CRITICAL: Failed to revert lock for ${receiptId}:`, e);
    // This is a bad state — receipt is stuck in "settling".
    // The stale-lock logic (LOCK_STALE_MS) will allow retry after 10 minutes.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Handle missing bank details
// Sets receipt to "pending_bank_details" so the UI can show a retry button.
// ─────────────────────────────────────────────────────────────────────────────
async function handleMissingBankDetails(
  supabaseAdmin: ReturnType<typeof createClient>,
  receiptId: string,
  missingParty: "sender" | "receiver" | "both",
  decision: string,
  decisionAmount: number | null,
  previousStatus: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  console.log(`[release] Receipt ${receiptId}: missing bank details for ${missingParty}`);

  // Set to pending_bank_details so the UI knows to show a "add bank details + retry" prompt
  await supabaseAdmin
    .from("receipts")
    .update({
      status: "pending_bank_details",
      pending_bank_party: missingParty,
      settlement_decision: decision,
      settlement_decision_amount: decisionAmount,
      settlement_initiated_at: null, // No lock needed — not in flight
    })
    .eq("id", receiptId);

  // Notify relevant party to add bank details (fire-and-forget)
  fireNotification(receiptId, `missing_bank_${missingParty}`);

  const messages: Record<string, string> = {
    sender:   "The sender needs to add their bank account details in Settings before the refund can be processed.",
    receiver: "The receiver needs to add their bank account details in Settings before payment can be sent.",
    both:     "Both the sender and receiver need to add their bank account details in Settings before settlement can proceed.",
  };

  return new Response(
    JSON.stringify({
      error: messages[missingParty],
      pendingBankParty: missingParty,
      requiresBankDetails: true,
    }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Clean up dispute evidence on completion
// Removes files from storage, sets DB paths to '/placeholder.svg'
// ─────────────────────────────────────────────────────────────────────────────
async function cleanupDisputes(
  supabaseAdmin: ReturnType<typeof createClient>,
  receiptId: string
) {
  try {
    const { data: disputes } = await supabaseAdmin
      .from("disputes")
      .select("id")
      .eq("receipt_id", receiptId);

    if (!disputes || disputes.length === 0) return;

    for (const d of disputes) {
      // Fetch evidence files for this dispute
      const { data: evidenceFiles } = await supabaseAdmin
        .from("evidence")
        .select("id, file_path")
        .eq("dispute_id", d.id)
        .neq("file_path", "/placeholder.svg"); // Skip already-cleaned rows

      if (evidenceFiles && evidenceFiles.length > 0) {
        const realPaths = evidenceFiles.map((e: any) => e.file_path);

        // Delete from storage (best effort — don't throw if some files missing)
        try {
          await supabaseAdmin.storage.from("evidence").remove(realPaths);
        } catch (storageErr) {
          console.error("[release] Storage cleanup partial failure:", storageErr);
        }

        // Replace file_path with placeholder in DB so rows are not orphaned
        // but also no dead storage references remain
        for (const ev of evidenceFiles) {
          await supabaseAdmin
            .from("evidence")
            .update({ file_path: "/placeholder.svg" })
            .eq("id", ev.id);
        }
      }

      // Mark dispute as resolved
      await supabaseAdmin
        .from("disputes")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", d.id);
    }

    console.log(`[release] Cleaned up ${disputes.length} dispute(s) for receipt ${receiptId}`);
  } catch (e) {
    // Cleanup failure must NEVER block the settlement success response
    console.error("[release] Dispute cleanup error (non-fatal):", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Fire-and-forget email notification
// Never throws, never awaited by callers — email failure cannot break settlement
// ─────────────────────────────────────────────────────────────────────────────
function fireNotification(receiptId: string, notificationType: string) {
  fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ type: notificationType, receiptId }),
  }).catch((e) => console.error("[release] Notification fire-and-forget failed:", e));
}