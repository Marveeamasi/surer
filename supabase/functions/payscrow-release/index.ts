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
    const { receiptId, decision, amount } = await req.json();

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

    // Fetch receipt
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

    if (!receipt.payscrow_transaction_number || !receipt.escrow_code) {
      console.log("No Payscrow transaction or escrow code for receipt:", receiptId);
      // Still update status locally
      await supabaseAdmin.from("receipts").update({ status: "completed" }).eq("id", receiptId);
      return new Response(JSON.stringify({ success: true, message: "Marked completed (no Payscrow transaction)" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine what to tell Payscrow based on the decision
    // decision: "release_all" => full release to merchant (receiver)
    // decision: "release_specific" => partial release with settlement accounts
    // decision: "refund" => full refund to customer (sender)

    // Get receiver bank details for settlement
    let receiverProfile = null;
    if (receipt.receiver_id) {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", receipt.receiver_id)
        .single();
      receiverProfile = data;
    }

    // For Payscrow, the escrow release is managed through their platform
    // The escrowCode is used by the merchant/customer on Payscrow to release funds
    // As a broker, we log the decision and update our status
    // In production, you may need to call Payscrow's dispute resolution API
    // to formally release or refund based on the decision

    console.log(`Processing release for receipt ${receiptId}: decision=${decision}, amount=${amount}`);

    // Update receipt as completed
    await supabaseAdmin
      .from("receipts")
      .update({ status: "completed" })
      .eq("id", receiptId);

    // Clean up disputes and evidence
    const { data: disputes } = await supabaseAdmin
      .from("disputes")
      .select("id")
      .eq("receipt_id", receiptId);

    if (disputes && disputes.length > 0) {
      for (const d of disputes) {
        // Delete evidence files from storage
        const { data: evidenceFiles } = await supabaseAdmin
          .from("evidence")
          .select("file_path")
          .eq("dispute_id", d.id);

        if (evidenceFiles && evidenceFiles.length > 0) {
          const paths = evidenceFiles.map((e: any) => e.file_path);
          await supabaseAdmin.storage.from("evidence").remove(paths);
          await supabaseAdmin.from("evidence").delete().eq("dispute_id", d.id);
        }

        await supabaseAdmin
          .from("disputes")
          .update({ status: "resolved", resolved_at: new Date().toISOString() })
          .eq("id", d.id);
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
        body: JSON.stringify({
          type: "dispute_resolved",
          receiptId,
        }),
      });
    } catch (e) {
      console.error("Failed to send notification:", e);
    }

    return new Response(
      JSON.stringify({ success: true, decision }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Release error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
