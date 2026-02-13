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

    // Find disputes past auto-execute time (2 days) that haven't been responded to
    const { data: autoExecDisputes } = await supabaseAdmin
      .from("disputes")
      .select("*, receipts(*)")
      .eq("status", "open")
      .lt("auto_execute_at", now);

    if (autoExecDisputes && autoExecDisputes.length > 0) {
      for (const dispute of autoExecDisputes) {
        // Auto-execute the proposed action
        await supabaseAdmin
          .from("disputes")
          .update({ status: "resolved", resolved_at: now })
          .eq("id", dispute.id);

        await supabaseAdmin
          .from("receipts")
          .update({ status: "completed" })
          .eq("id", dispute.receipt_id);

        console.log(`Auto-executed dispute ${dispute.id} for receipt ${dispute.receipt_id}`);
      }
    }

    // Find disputes past 4 days that are still unresolved
    const { data: expiredDisputes } = await supabaseAdmin
      .from("disputes")
      .select("*")
      .in("status", ["open", "pending_response"])
      .lt("expires_at", now);

    if (expiredDisputes && expiredDisputes.length > 0) {
      for (const dispute of expiredDisputes) {
        await supabaseAdmin
          .from("disputes")
          .update({ status: "escalated" })
          .eq("id", dispute.id);

        await supabaseAdmin
          .from("receipts")
          .update({ status: "unresolved" })
          .eq("id", dispute.receipt_id);

        console.log(`Escalated dispute ${dispute.id} to admin`);
      }
    }

    return new Response(
      JSON.stringify({
        autoExecuted: autoExecDisputes?.length || 0,
        escalated: expiredDisputes?.length || 0,
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
