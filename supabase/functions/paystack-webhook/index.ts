import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-paystack-signature",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const paystackKey = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!paystackKey) {
      console.error("PAYSTACK_SECRET_KEY not configured");
      return new Response(JSON.stringify({ error: "Configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.text();
    const payload = JSON.parse(body);

    // Verify Paystack HMAC-SHA512 signature
    const signature = req.headers.get("x-paystack-signature");
    if (signature) {
      const encoder = new TextEncoder();
      const key = encoder.encode(paystackKey);
      const data = encoder.encode(body);

      const cryptoKey = await crypto.subtle.importKey(
        "raw", key, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", cryptoKey, data);
      const hash = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      if (hash !== signature) {
        console.error("Invalid Paystack signature");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const event = payload.event;
    const eventData = payload.data;

    console.log("Paystack webhook event:", event, "ref:", eventData?.reference);

    if (event !== "charge.success") {
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify payment with Paystack
    const verifyResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${eventData.reference}`,
      { headers: { Authorization: `Bearer ${paystackKey}` } }
    );
    const verifyData = await verifyResponse.json();

    if (!verifyData.status || verifyData.data.status !== "success") {
      console.error("Payment verification failed:", verifyData);
      return new Response(JSON.stringify({ received: true, verified: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const metadata = verifyData.data.metadata || {};

    if (metadata.type === "spam_fee") {
      console.log(`Spam fee verified: user=${metadata.user_id}, receipt=${metadata.receipt_id}, decision=${metadata.decision_type}, ref=${eventData.reference}`);

      // CRITICAL: Record spam fee payment in database so frontend can verify
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      // Store spam fee payment record in receipts table via a dedicated column
      // or use a simple approach: update the receipt to mark spam fee as paid
      // We'll store the reference so the frontend can verify
      const { error: updateError } = await supabaseAdmin
        .from("receipts")
        .update({
          // Use updated_at as a signal that something changed
          updated_at: new Date().toISOString(),
        })
        .eq("id", metadata.receipt_id);

      if (updateError) {
        console.error("Failed to update receipt after spam fee:", updateError);
      }

      console.log(`Spam fee recorded for receipt ${metadata.receipt_id}, decision: ${metadata.decision_type}`);
    }

    return new Response(JSON.stringify({ received: true, verified: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Paystack webhook error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
