/**
 * cron-dispute-check.ts — Daily cron job (called via pg_cron or external scheduler)
 *
 * ─── PRODUCTION-GRADE RELIABILITY ───────────────────────────────────────────
 *
 * IDEMPOTENCY: Safe to run multiple times. Each check:
 *   - Skips receipts already "settling" or "completed"
 *   - Skips receipts already "pending_bank_details" (already notified, awaiting user action)
 *   - Uses payscrow-release which has its own idempotency lock
 *
 * DOUBLE-RUN SAFETY: If cron fires twice simultaneously:
 *   - The first run acquires the "settling" lock in payscrow-release
 *   - The second run sees status="settling" and is rejected (409)
 *   - No double payment
 *
 * AUTO-EXECUTE RULES (active receipts only, per README):
 *   decision 4 (delivered) + no sender reply → release_all to receiver
 *   decision 1 (release_all) + no receiver reply → release_all to receiver
 *   decision 2 (release_specific) + no receiver reply → release_specific
 *   decision 3 (refund) + no receiver reply → refund to sender
 *
 * BANK DETAILS MISSING:
 *   - payscrow-release sets status to "pending_bank_details"
 *   - Cron does NOT retry pending_bank_details receipts — user must add bank details
 *   - The ReceiptView UI shows a retry button for pending_bank_details status
 *
 * ESCALATION RULES (dispute receipts):
 *   - If dispute.expires_at has passed → set receipt to "unresolved"
 *   - Admin then resolves via Admin panel
 *   - Email sent to both parties (fire-and-forget, never blocks)
 *
 * EMAIL: All notifications are fire-and-forget. Email failure NEVER causes
 *   a cron failure or prevents any status update.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Statuses that mean "don't touch this receipt"
const SKIP_STATUSES = new Set(["completed", "settling", "pending_bank_details"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now       = new Date().toISOString();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let autoExecuted = 0;
    let autoFailed   = 0;
    let escalated    = 0;
    const errors: string[] = [];

    // ════════════════════════════════════════════════════════════════════════
    // STEP 1: AUTO-EXECUTE — active receipts whose 2-day timer has expired
    //
    // Only runs for receipts with:
    //   - status = "active"
    //   - decision_auto_execute_at < NOW (timer expired)
    //   - NOT already settling/completed/pending_bank_details
    // ════════════════════════════════════════════════════════════════════════

    const { data: overdueReceipts, error: fetchErr } = await supabaseAdmin
      .from("receipts")
      .select("id, status, sender_decision, sender_decision_amount, receiver_decision, settlement_initiated_at")
      .eq("status", "active")               // Only active receipts
      .not("decision_auto_execute_at", "is", null)
      .lt("decision_auto_execute_at", now); // Timer expired

    if (fetchErr) {
      console.error("[cron] Failed to fetch overdue receipts:", fetchErr);
      errors.push(`Fetch error: ${fetchErr.message}`);
    }

    if (overdueReceipts && overdueReceipts.length > 0) {
      console.log(`[cron] Found ${overdueReceipts.length} receipt(s) ready for auto-execution`);

      for (const receipt of overdueReceipts) {

        // Double-check: skip if somehow already in a terminal/locked state
        if (SKIP_STATUSES.has(receipt.status)) {
          console.log(`[cron] Skipping ${receipt.id}: status="${receipt.status}"`);
          continue;
        }

        // Determine what decision to execute
        // ── Decision 4 only (receiver delivered, sender silent) → release all
        // ── Decision 1 only (sender release_all, receiver silent) → release all
        // ── Decision 2 only (sender release_specific, receiver silent) → release_specific
        // ── Decision 3 only (sender refund, receiver silent) → refund
        let decision: string = "";
        let decisionAmount: number | null = null;

        if (receipt.receiver_decision === "delivered" && !receipt.sender_decision) {
          // Receiver delivered, sender never responded → auto-release to receiver
          decision = "release_all";

        } else if (receipt.sender_decision && !receipt.receiver_decision) {
          // Sender decided, receiver never responded → execute sender's decision
          switch (receipt.sender_decision) {
            case "release_all":
              decision = "release_all";
              break;
            case "release_specific":
              decision       = "release_specific";
              decisionAmount = Number(receipt.sender_decision_amount);
              if (!decisionAmount || decisionAmount <= 0) {
                console.error(`[cron] Receipt ${receipt.id}: release_specific with no amount — skipping`);
                errors.push(`Receipt ${receipt.id}: release_specific missing amount`);
                continue;
              }
              break;
            case "refund":
              decision = "refund";
              break;
            default:
              console.error(`[cron] Receipt ${receipt.id}: unknown sender_decision="${receipt.sender_decision}" — skipping`);
              continue;
          }
        } else {
          // Both decided (somehow not resolved) or neither decided — skip
          // This shouldn't happen in normal flow; log it for investigation
          console.log(`[cron] Receipt ${receipt.id}: unexpected decision state — sender="${receipt.sender_decision}" receiver="${receipt.receiver_decision}" — skipping`);
          continue;
        }

        console.log(`[cron] Auto-executing receipt ${receipt.id}: decision=${decision} amount=${decisionAmount}`);

        try {
          const releaseRes = await fetch(
            `${supabaseUrl}/functions/v1/payscrow-release`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                receiptId: receipt.id,
                decision,
                amount: decisionAmount,
              }),
            }
          );

          const releaseData = await releaseRes.json().catch(() => ({}));

          if (releaseRes.ok && releaseData.success) {
            autoExecuted++;
            console.log(`[cron] Auto-executed receipt ${receipt.id} successfully`);

          } else if (releaseData.requiresBankDetails) {
            // payscrow-release set the receipt to "pending_bank_details"
            // and already sent a notification to the relevant party.
            // We log this but do NOT retry — user must add bank details.
            autoFailed++;
            console.log(`[cron] Receipt ${receipt.id}: pending bank details (${releaseData.pendingBankParty}) — user notified`);

          } else if (releaseRes.status === 409) {
            // Already being settled (race condition with another cron run) — safe to skip
            console.log(`[cron] Receipt ${receipt.id}: already settling (409) — skipping`);

          } else {
            // Other failure (e.g. Payscrow API error)
            autoFailed++;
            const errMsg = releaseData.error || `HTTP ${releaseRes.status}`;
            console.error(`[cron] Auto-execute failed for receipt ${receipt.id}: ${errMsg}`);
            errors.push(`Receipt ${receipt.id}: ${errMsg}`);
          }
        } catch (callErr) {
          autoFailed++;
          console.error(`[cron] Network error calling payscrow-release for ${receipt.id}:`, callErr);
          errors.push(`Receipt ${receipt.id}: network error`);
          // Receipt stays "active" with expired timer — will be retried next cron run
        }
      }
    } else {
      console.log("[cron] No receipts ready for auto-execution");
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 2: ESCALATE — dispute receipts whose 4-day window has expired
    //
    // Only runs for receipts with:
    //   - status = "dispute"
    //   - open dispute with expires_at < NOW
    // ════════════════════════════════════════════════════════════════════════

    const { data: disputeReceipts, error: disputeFetchErr } = await supabaseAdmin
      .from("receipts")
      .select("id")
      .eq("status", "dispute");

    if (disputeFetchErr) {
      console.error("[cron] Failed to fetch dispute receipts:", disputeFetchErr);
      errors.push(`Dispute fetch error: ${disputeFetchErr.message}`);
    }

    if (disputeReceipts && disputeReceipts.length > 0) {
      console.log(`[cron] Checking ${disputeReceipts.length} dispute receipt(s) for expiry`);

      for (const receipt of disputeReceipts) {
        // Find open disputes for this receipt whose expiry has passed
        const { data: expiredDisputes } = await supabaseAdmin
          .from("disputes")
          .select("id")
          .eq("receipt_id", receipt.id)
          .eq("status", "open")
          .not("expires_at", "is", null)
          .lt("expires_at", now);

        if (!expiredDisputes || expiredDisputes.length === 0) continue;

        // Escalate receipt to unresolved
        const { error: escalateErr } = await supabaseAdmin
          .from("receipts")
          .update({
            status: "unresolved",
            decision_auto_execute_at: null, // Clear any stale timer
          })
          .eq("id", receipt.id)
          .eq("status", "dispute"); // Only escalate if still in dispute (idempotent guard)

        if (escalateErr) {
          console.error(`[cron] Failed to escalate receipt ${receipt.id}:`, escalateErr);
          errors.push(`Escalate error for ${receipt.id}: ${escalateErr.message}`);
          continue;
        }

        // Mark all expired disputes as escalated
        for (const d of expiredDisputes) {
          await supabaseAdmin
            .from("disputes")
            .update({ status: "escalated" })
            .eq("id", d.id)
            .eq("status", "open"); // Idempotent guard
        }

        // Notify both parties — fire-and-forget
        fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ type: "dispute_escalated", receiptId: receipt.id }),
        }).catch((e) => console.error("[cron] Escalation notification failed:", e));

        escalated++;
        console.log(`[cron] Escalated receipt ${receipt.id} to unresolved`);
      }
    } else {
      console.log("[cron] No dispute receipts to check");
    }

    // ════════════════════════════════════════════════════════════════════════
    // DONE
    // ════════════════════════════════════════════════════════════════════════
    console.log(`[cron] Complete: ${autoExecuted} auto-executed, ${autoFailed} failed, ${escalated} escalated`);

    return new Response(
      JSON.stringify({
        success: true,
        autoExecuted,
        autoFailed,
        escalated,
        errors: errors.length > 0 ? errors : undefined,
        checkedAt: now,
        message: `Cron complete: ${autoExecuted} auto-execution(s), ${autoFailed} failure(s), ${escalated} escalation(s)`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[cron] Fatal error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});