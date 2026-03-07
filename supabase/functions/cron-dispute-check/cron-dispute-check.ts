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
    // If one party made a decision and 2 days passed with no counter-response,
    // execute the existing decision automatically via /broker/settle.
    // ============================================================
    const { data: activeReceipts } = await supabaseAdmin
      .from("receipts")
      .select("*")
      .eq("status", "active")
      .not("decision_auto_execute_at", "is", null)
      .lt("decision_auto_execute_at", now);

    if (activeReceipts && activeReceipts.length > 0) {
      for (const receipt of activeReceipts) {
        let decision = "";
        let amount: number | null = null;

        if (receipt.sender_decision && !receipt.receiver_decision) {
          // Sender made a decision, receiver didn't respond in 2 days
          // Execute the sender's decision as-is
          if (receipt.sender_decision === "release_all") {
            decision = "release_all";
          } else if (receipt.sender_decision === "release_specific") {
            decision = "release_specific";
            amount = receipt.sender_decision_amount;
          } else if (receipt.sender_decision === "refund") {
            decision = "refund";
          }
        } else if (receipt.receiver_decision && !receipt.sender_decision) {
          // Receiver clicked "delivered" (4), sender didn't respond in 2 days
          // Auto-release full payment to receiver
          decision = "release_all";
          amount = null;
        } else {
          // Both made decisions but somehow not resolved - skip
          continue;
        }

        if (!decision) continue;

        console.log(`Auto-executing receipt ${receipt.id}: decision=${decision}, amount=${amount}`);

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

          if (releaseRes.ok && releaseData.success) {
            autoExecuted++;
          } else {
            console.error(`Release failed for ${receipt.id}:`, JSON.stringify(releaseData));
          }
        } catch (e) {
          console.error("Release call failed for receipt:", receipt.id, e);
        }
      }
    }

    // ============================================================
    // 2. ESCALATE: Disputes on "dispute" receipts past 4-day window
    // If a receipt has been in "dispute" status and the dispute's
    // expires_at has passed, escalate to "unresolved" for admin.
    // ============================================================
    const { data: disputeReceipts } = await supabaseAdmin
      .from("receipts")
      .select("*")
      .eq("status", "dispute");

    if (disputeReceipts && disputeReceipts.length > 0) {
      for (const receipt of disputeReceipts) {
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

          // Notify both parties
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
        message: `Daily check: ${autoExecuted} auto-executions, ${escalated} escalations`,
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
