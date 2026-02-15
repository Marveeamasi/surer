import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date().toISOString();
    let autoExecuted = 0;
    let escalated = 0;

    // ============================================================
    // 1. AUTO-EXECUTE: Active receipts with a decision past 2-day timer
    // If one party made a decision and 2 days passed with no response,
    // execute the existing decision automatically.
    // ============================================================
    const { data: activeReceipts } = await supabaseAdmin
      .from("receipts")
      .select("*")
      .eq("status", "active")
      .not("decision_auto_execute_at", "is", null)
      .lt("decision_auto_execute_at", now);

    if (activeReceipts && activeReceipts.length > 0) {
      for (const receipt of activeReceipts) {
        // Determine what decision to execute
        let decision = "";
        let amount: number | null = null;

        if (receipt.sender_decision && !receipt.receiver_decision) {
          // Sender made a decision, receiver didn't respond in 2 days
          decision = receipt.sender_decision;
          amount = receipt.sender_decision_amount;
        } else if (receipt.receiver_decision && !receipt.sender_decision) {
          // Receiver made a decision (delivered), sender didn't respond in 2 days
          // "delivered" by receiver with no sender response = release_all
          decision = "release_all";
          amount = null;
        } else {
          // Both made decisions but somehow didn't resolve - skip
          continue;
        }

        console.log(`Auto-executing receipt ${receipt.id}: decision=${decision}, amount=${amount}`);

        // Call payscrow-release to execute the decision
        try {
          const releaseRes = await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/payscrow-release`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({
                receiptId: receipt.id,
                decision,
                amount,
              }),
            }
          );
          const releaseData = await releaseRes.json();
          console.log(`Release result for ${receipt.id}:`, JSON.stringify(releaseData));
        } catch (e) {
          console.error("Release call failed for receipt:", receipt.id, e);
        }

        autoExecuted++;
      }
    }

    // ============================================================
    // 2. ESCALATE: Disputes on "dispute" receipts past 4-day window
    // If a receipt has been in "dispute" status for 4 days, escalate
    // to "unresolved" so only admin can decide.
    // ============================================================
    const { data: disputeReceipts } = await supabaseAdmin
      .from("receipts")
      .select("*")
      .eq("status", "dispute");

    if (disputeReceipts && disputeReceipts.length > 0) {
      for (const receipt of disputeReceipts) {
        // Check if there's a dispute with an expired timer (4 days)
        const { data: disputes } = await supabaseAdmin
          .from("disputes")
          .select("*")
          .eq("receipt_id", receipt.id)
          .eq("status", "open")
          .not("expires_at", "is", null)
          .lt("expires_at", now);

        if (disputes && disputes.length > 0) {
          // Escalate to unresolved
          await supabaseAdmin
            .from("receipts")
            .update({ status: "unresolved", decision_auto_execute_at: null })
            .eq("id", receipt.id);

          for (const dispute of disputes) {
            await supabaseAdmin
              .from("disputes")
              .update({ status: "escalated" })
              .eq("id", dispute.id);
          }

          // Send notification to both parties
          try {
            await fetch(
              `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification-email`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({
                  type: "dispute_escalated",
                  receiptId: receipt.id,
                }),
              }
            );
          } catch (e) {
            console.error("Failed to send escalation notification:", e);
          }

          escalated++;
          console.log(`Escalated receipt ${receipt.id} to unresolved`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        autoExecuted,
        escalated,
        checkedAt: now,
        message: `Processed ${autoExecuted} auto-executions and ${escalated} escalations`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Cron error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
