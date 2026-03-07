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
    const payload = await req.json();
    console.log("Payscrow webhook received:", JSON.stringify(payload));

    const {
      transactionNumber,
      escrowCode,
      externalReference,
      paymentStatus,
      amountPaid,
    } = payload;

    if (paymentStatus !== "Paid") {
      return new Response(JSON.stringify({ received: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find receipt by transaction ref
    const { data: receipt, error } = await supabaseAdmin
      .from("receipts")
      .select("*")
      .eq("payscrow_transaction_ref", externalReference)
      .single();

    if (error || !receipt) {
      console.error("Receipt not found for ref:", externalReference);
      return new Response(JSON.stringify({ received: true, error: "Receipt not found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency check
    if (receipt.status !== "pending") {
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update receipt to active
    await supabaseAdmin
      .from("receipts")
      .update({
        status: "active",
        escrow_code: escrowCode,
        paid_at: new Date().toISOString(),
        amount_paid: parseFloat(amountPaid),
      })
      .eq("id", receipt.id);

    // Send notification email
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          type: "payment_confirmed",
          receiptId: receipt.id,
        }),
      });
    } catch (e) {
      console.error("Failed to send notification:", e);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
