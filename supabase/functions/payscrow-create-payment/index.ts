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
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

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

    if (receipt.sender_id !== user.id) {
      return new Response(JSON.stringify({ error: "Only the sender can pay" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: senderProfile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    const payscrowApiKey = Deno.env.get("PAYSCROW_BROKER_API_KEY");
    if (!payscrowApiKey) {
      return new Response(JSON.stringify({ error: "Payscrow not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const transactionRef = `SURER-${receipt.id.slice(0, 8)}-${Date.now()}`;
    const origin = req.headers.get("origin") || "https://surer.com.ng";

    // Calculate total: item amount + surer fee (1.5%)
    // DO NOT include settlementAccounts here — we settle at the END via /broker/settle
    const surerFee = receipt.surer_fee || 0;
    const totalItemPrice = receipt.amount + surerFee;

    const requestBody = {
      transactionReference: transactionRef,
      merchantEmailAddress: receipt.receiver_email,
      merchantName: receipt.receiver_email.split("@")[0],
      customerEmailAddress: user.email,
      customerName: senderProfile?.display_name || user.email!.split("@")[0],
      customerPhoneNo: "08000000000",
      merchantPhoneNo: "08000000000",
      currencyCode: "NGN",
      merchantChargePercentage: 0, // Customer (sender) pays all Payscrow charges
      returnUrl: `${origin}/receipt/${receipt.id}`,
      webhookNotificationUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payscrow-webhook`,
      items: [
        {
          name: receipt.description,
          description: receipt.description,
          quantity: 1,
          price: totalItemPrice,
        },
      ],
      // NO settlementAccounts — money stays fluid in escrow until /broker/settle is called
    };

    console.log("Creating Payscrow payment (no pre-settlement):", JSON.stringify(requestBody));

    const payscrowResponse = await fetch(
      `${PAYSCROW_API_BASE}/transactions/start`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          BrokerApiKey: payscrowApiKey,
        },
        body: JSON.stringify(requestBody),
      },
    );

    const payscrowData = await payscrowResponse.json();
    console.log("Payscrow response:", JSON.stringify(payscrowData));

    if (!payscrowResponse.ok || !payscrowData.success) {
      let errorMsg = "Payscrow error";
      if (Array.isArray(payscrowData?.errors)) {
        errorMsg = payscrowData.errors.join(", ");
      } else if (typeof payscrowData?.errors === "object" && payscrowData.errors !== null) {
        errorMsg = Object.values(payscrowData.errors).flat().join(", ");
      } else if (typeof payscrowData?.errors === "string") {
        errorMsg = payscrowData.errors;
      } else if (payscrowData?.message) {
        errorMsg = payscrowData.message;
      }
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Store transaction reference and number
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
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
