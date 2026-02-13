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

    const { receiptId } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

    // Verify user is the sender
    if (receipt.sender_id !== user.id) {
      return new Response(JSON.stringify({ error: "Only the sender can pay" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get sender and receiver profiles
    const { data: senderProfile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    const transactionRef = `SURER-${receipt.id.slice(0, 8)}-${Date.now()}`;
    const origin = req.headers.get("origin") || "https://surer.lovable.app";

    // Create Payscrow transaction
    const payscrowApiKey = Deno.env.get("PAYSCROW_BROKER_API_KEY");
    if (!payscrowApiKey) {
      return new Response(JSON.stringify({ error: "Payscrow not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payscrowResponse = await fetch(`${PAYSCROW_API_BASE}/transactions/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "BrokerApiKey": payscrowApiKey,
      },
      body: JSON.stringify({
        transactionReference: transactionRef,
        merchantEmailAddress: receipt.receiver_email,
        merchantName: receipt.receiver_email.split("@")[0],
        customerEmailAddress: user.email,
        customerName: senderProfile?.display_name || user.email!.split("@")[0],
        currencyCode: "NGN",
        merchantChargePercentage: 0, // Customer pays all Payscrow charges
        returnUrl: `${origin}/receipt/${receipt.id}`,
        webhookNotificationUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payscrow-webhook`,
        items: [
          {
            name: receipt.description,
            description: receipt.description,
            quantity: 1,
            price: receipt.amount + receipt.surer_fee, // Include Surer fee in escrow amount
          },
        ],
      }),
    });

    const payscrowData = await payscrowResponse.json();

    if (!payscrowResponse.ok || !payscrowData.success) {
      const errorMsg = payscrowData.errors?.join(", ") || payscrowData.message || "Payscrow error";
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Store transaction reference
    await supabaseAdmin
      .from("receipts")
      .update({
        payscrow_transaction_ref: transactionRef,
        payscrow_transaction_number: payscrowData.data.transactionNumber,
      })
      .eq("id", receiptId);

    return new Response(
      JSON.stringify({
        paymentLink: payscrowData.data.paymentLink,
        totalPayable: payscrowData.data.totalPayable,
        transactionNumber: payscrowData.data.transactionNumber,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
