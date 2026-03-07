import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { reference, receiptId } = await req.json();
    if (!reference || !receiptId) {
      return new Response(JSON.stringify({ error: "Missing reference or receiptId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const paystackKey = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!paystackKey) {
      return new Response(JSON.stringify({ error: "Paystack not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify transaction directly with Paystack
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${paystackKey}` } }
    );
    const verifyData = await verifyRes.json();

    if (!verifyData.status || verifyData.data.status !== "success") {
      return new Response(
        JSON.stringify({ success: false, message: "Transaction not successful" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const metadata = verifyData.data.metadata || {};

    // ensure the transaction was for a spam fee and correct receipt
    if (metadata.type !== "spam_fee" || metadata.receipt_id !== receiptId) {
      console.warn("Metadata mismatch on spam fee verification", metadata, receiptId);
      return new Response(
        JSON.stringify({ success: false, message: "Metadata mismatch" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: updateError } = await supabaseAdmin
      .from("receipts")
      .update({
        spam_fee_paid: true,
        spam_fee_reference: reference,
        spam_fee_decision: metadata.decision_type || null,
        spam_fee_amount: (verifyData.data.amount || 0) / 100,
      })
      .eq("id", receiptId);

    if (updateError) {
      console.error("Failed to mark spam fee during verify:", updateError);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Paystack verify error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
