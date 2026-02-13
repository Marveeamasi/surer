import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAYSCROW_API_BASE = "https://api.payscrow.net/api/v3/marketplace";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { receiptId, reason, proposedAction, proposedAmount } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: receipt } = await supabaseAdmin
      .from("receipts")
      .select("*")
      .eq("id", receiptId)
      .single();

    if (!receipt) {
      return new Response(JSON.stringify({ error: "Receipt not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create dispute in our DB
    const expiresAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(); // 4 days
    const autoExecuteAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days

    const { data: dispute, error: disputeError } = await supabaseAdmin
      .from("disputes")
      .insert({
        receipt_id: receiptId,
        initiated_by: user.id,
        reason,
        proposed_action: proposedAction,
        proposed_amount: proposedAmount || null,
        status: "open",
        expires_at: expiresAt,
        auto_execute_at: autoExecuteAt,
      })
      .select()
      .single();

    if (disputeError) {
      return new Response(JSON.stringify({ error: "Failed to create dispute" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update receipt status
    await supabaseAdmin
      .from("receipts")
      .update({ status: "dispute" })
      .eq("id", receiptId);

    // Raise dispute on Payscrow if transaction exists
    if (receipt.payscrow_transaction_number) {
      const payscrowApiKey = Deno.env.get("PAYSCROW_BROKER_API_KEY");
      if (payscrowApiKey) {
        try {
          await fetch(
            `${PAYSCROW_API_BASE}/transactions/${receipt.payscrow_transaction_number}/broker/raise-dispute`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "BrokerApiKey": payscrowApiKey,
              },
              body: JSON.stringify({
                requestedBy: receipt.sender_id === user.id ? "customer" : "merchant",
                complaint: reason,
              }),
            }
          );
        } catch (e) {
          console.error("Failed to raise Payscrow dispute:", e);
        }
      }
    }

    // Send notification
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ type: "dispute_started", receiptId }),
      });
    } catch (e) {
      console.error("Failed to send notification:", e);
    }

    return new Response(
      JSON.stringify({ success: true, dispute }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Dispute error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
