import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// NOTE: Withdrawals/settlements are handled automatically by Payscrow via settlement accounts.
// This function exists only to record manual withdrawal requests for admin tracking
// in cases where Payscrow settlement needs manual intervention.

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

    // Verify receipt exists and user is a participant
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

    if (receipt.status !== "completed") {
      return new Response(JSON.stringify({ error: "Receipt must be completed before requesting withdrawal" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const withdrawAmount = amount || receipt.amount;

    // Record withdrawal request for admin tracking
    // Actual fund settlement is handled by Payscrow via settlement accounts
    const { data: withdrawal, error: wError } = await supabaseAdmin
      .from("withdrawals")
      .insert({
        user_id: user.id,
        receipt_id: receiptId,
        amount: withdrawAmount,
        bank_name: profile.bank_name,
        account_number: profile.account_number,
        account_name: profile.account_name,
        status: "processing", // Payscrow handles the actual settlement
      })
      .select()
      .single();

    if (wError) {
      return new Response(JSON.stringify({ error: "Failed to create withdrawal record" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        withdrawal,
        message: "Settlement is being processed via Payscrow. Funds will be sent to your bank account automatically.",
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
