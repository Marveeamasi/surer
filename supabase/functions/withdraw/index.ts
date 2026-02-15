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
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { receiptId, amount } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const paystackKey = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!paystackKey) {
      return new Response(JSON.stringify({ error: "Payment processor not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user profile for bank details
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!profile?.bank_name || !profile?.account_number || !profile?.account_name) {
      return new Response(JSON.stringify({ error: "Please set your bank details in Settings first" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify receipt and user is receiver
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

    if (receipt.receiver_id !== user.id) {
      return new Response(JSON.stringify({ error: "Only the receiver can withdraw" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (receipt.status !== "completed") {
      return new Response(JSON.stringify({ error: "Receipt must be completed to withdraw" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const withdrawAmount = amount || receipt.amount;

    // Step 1: Create Paystack transfer recipient
    const recipientResponse = await fetch("https://api.paystack.co/transferrecipient", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${paystackKey}`,
      },
      body: JSON.stringify({
        type: "nuban",
        name: profile.account_name,
        account_number: profile.account_number,
        bank_code: profile.bank_name, // Bank name stored as code for Paystack
        currency: "NGN",
      }),
    });

    const recipientData = await recipientResponse.json();

    if (!recipientData.status) {
      console.error("Paystack recipient creation failed:", recipientData);
      
      // Create withdrawal record as pending for manual processing
      const { data: withdrawal } = await supabaseAdmin
        .from("withdrawals")
        .insert({
          user_id: user.id,
          receipt_id: receiptId,
          amount: withdrawAmount,
          bank_name: profile.bank_name,
          account_number: profile.account_number,
          account_name: profile.account_name,
          status: "pending",
        })
        .select()
        .single();

      return new Response(
        JSON.stringify({
          success: true,
          withdrawal,
          message: "Withdrawal queued for manual processing",
          auto_transfer: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recipientCode = recipientData.data.recipient_code;

    // Step 2: Initiate Paystack transfer
    const transferResponse = await fetch("https://api.paystack.co/transfer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${paystackKey}`,
      },
      body: JSON.stringify({
        source: "balance",
        reason: `Surer withdrawal for receipt ${receiptId.slice(0, 8)}`,
        amount: Math.round(withdrawAmount * 100), // Paystack uses kobo
        recipient: recipientCode,
        reference: `SURER-WD-${receiptId.slice(0, 8)}-${Date.now()}`,
      }),
    });

    const transferData = await transferResponse.json();
    console.log("Paystack transfer response:", JSON.stringify(transferData));

    const transferStatus = transferData.status ? "processing" : "failed";

    // Create withdrawal record
    const { data: withdrawal, error: wError } = await supabaseAdmin
      .from("withdrawals")
      .insert({
        user_id: user.id,
        receipt_id: receiptId,
        amount: withdrawAmount,
        bank_name: profile.bank_name,
        account_number: profile.account_number,
        account_name: profile.account_name,
        status: transferStatus,
      })
      .select()
      .single();

    if (wError) {
      return new Response(JSON.stringify({ error: "Failed to create withdrawal record" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send notification email
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          type: "withdrawal_success",
          receiptId,
        }),
      });
    } catch (e) {
      console.error("Failed to send withdrawal notification:", e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        withdrawal,
        auto_transfer: transferData.status,
        transfer_reference: transferData.data?.reference || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Withdrawal error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
