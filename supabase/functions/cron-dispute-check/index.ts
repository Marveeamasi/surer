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

    // 1. Auto-execute decisions on ACTIVE receipts past 2-day timer
    // If only one party made a decision and 2 days passed, execute it
    const { data: activeReceipts } = await supabaseAdmin
      .from("receipts")
      .select("*")
      .eq("status", "active")
      .not("decision_auto_execute_at", "is", null)
      .lt("decision_auto_execute_at", now);

    if (activeReceipts && activeReceipts.length > 0) {
      for (const receipt of activeReceipts) {
        // Auto-execute the existing decision
        const decision = receipt.sender_decision || receipt.receiver_decision;
        if (!decision) continue;

        // Mark as completed and invoke release
        await supabaseAdmin
          .from("receipts")
          .update({ status: "completed", decision_auto_execute_at: null })
          .eq("id", receipt.id);

        // Call release function
        try {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/payscrow-release`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({
              receiptId: receipt.id,
              decision: receipt.sender_decision || "release_all",
              amount: receipt.sender_decision_amount || null,
            }),
          });
        } catch (e) {
          console.error("Release call failed for receipt:", receipt.id, e);
        }

        autoExecuted++;
        console.log(`Auto-executed receipt ${receipt.id}, decision: ${decision}`);
      }
    }

    // 2. Escalate disputes past 4 days to unresolved
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
          .not("expires_at", "is", null)
          .lt("expires_at", now);

        if (disputes && disputes.length > 0) {
          await supabaseAdmin
            .from("receipts")
            .update({ status: "unresolved" })
            .eq("id", receipt.id);

          for (const dispute of disputes) {
            await supabaseAdmin
              .from("disputes")
              .update({ status: "escalated" })
              .eq("id", dispute.id);
          }

          escalated++;
          console.log(`Escalated receipt ${receipt.id} to unresolved`);
        }
      }
    }

    // 3. Also check disputes on active receipts that have both decisions but somehow didn't resolve
    // (edge case cleanup)

    return new Response(
      JSON.stringify({
        autoExecuted,
        escalated,
        checkedAt: now,
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
