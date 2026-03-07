import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// IMPORTANT: We do NOT call Payscrow's raise-dispute API.
// Disputes are handled locally by Surer. Money stays "In Progress" on Payscrow
// so that the /broker/settle command works when a final decision is made.

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

    // Create dispute in our DB (local only — NO Payscrow API call)
    const expiresAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();
    const autoExecuteAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

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

    // Update receipt status to dispute
    await supabaseAdmin
      .from("receipts")
      .update({ status: "dispute" })
      .eq("id", receiptId);

    // Send notification to both parties
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
