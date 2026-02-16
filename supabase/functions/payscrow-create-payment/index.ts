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

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
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
      return new Response(
        JSON.stringify({ error: "Only the sender can pay" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Get sender profile
    const { data: senderProfile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    // Get admin user for platform fee settlement
    const { data: adminRole } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();

    let adminProfile: any = null;
    if (adminRole) {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", adminRole.user_id)
        .single();
      adminProfile = data;
    }

    // Get receiver profile for settlement account
    const { data: receiverProfile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("email", receipt.receiver_email)
      .maybeSingle();

    const payscrowApiKey = Deno.env.get("PAYSCROW_BROKER_API_KEY");
    if (!payscrowApiKey) {
      return new Response(
        JSON.stringify({ error: "Payscrow not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const transactionRef = `SURER-${receipt.id.slice(0, 8)}-${Date.now()}`;
    const origin = req.headers.get("origin") || "https://surer.com.ng";

    // Build settlement accounts array
    // Total settlement must equal total item amount (receipt.amount + surer_fee)
    const settlementAccounts: any[] = [];
    const surerFee = receipt.surer_fee || 0;
    const receiverAmount = receipt.amount;

    // Admin settlement for Surer platform fee (1.5%)
    if (adminProfile?.bank_code && adminProfile?.account_number && adminProfile?.account_name && surerFee > 0) {
      settlementAccounts.push({
        bankCode: adminProfile.bank_code,
        accountNumber: adminProfile.account_number,
        accountName: adminProfile.account_name,
        amount: surerFee,
      });
    }

    // Receiver settlement for the transaction amount
    if (receiverProfile?.bank_code && receiverProfile?.account_number && receiverProfile?.account_name) {
      settlementAccounts.push({
        bankCode: receiverProfile.bank_code,
        accountNumber: receiverProfile.account_number,
        accountName: receiverProfile.account_name,
        amount: receiverAmount,
      });
    }

    // If we couldn't build settlement accounts (missing bank details), skip them
    // Payscrow will settle to merchant account by default
    const requestBody: any = {
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
          price: receiverAmount + surerFee,
        },
      ],
    };

    // Only add settlement accounts if we have valid entries that cover the full amount
    const totalSettlement = settlementAccounts.reduce((sum: number, a: any) => sum + a.amount, 0);
    if (settlementAccounts.length > 0 && Math.abs(totalSettlement - (receiverAmount + surerFee)) < 1) {
      requestBody.settlementAccounts = settlementAccounts;
      console.log("Settlement accounts configured:", JSON.stringify(settlementAccounts));
    } else if (settlementAccounts.length > 0) {
      console.log("Settlement accounts skipped - total mismatch:", totalSettlement, "vs", receiverAmount + surerFee);
    }

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
