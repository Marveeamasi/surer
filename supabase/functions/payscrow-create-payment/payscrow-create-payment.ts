import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAYSCROW_API_BASE = "https://api.payscrow.net/api/v3/marketplace";

const DEFAULT_FEE_PCT  = 3.5;
const DEFAULT_BASE_FEE = 100;
const DEFAULT_FEE_CAP  = 2000;

function calcProtectionFee(amount: number, pct: number, base: number, cap: number): number {
  return Math.min((amount * pct) / 100 + base, cap);
}

function generateFallbackPhone(userId: string): string {
  const hex    = userId.replace(/-/g, "").slice(0, 8);
  const digits = hex.split("").map((c) => (parseInt(c, 16) % 10).toString()).join("");
  return `080${digits}`; 
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { receiptId } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Fetch receipt ─────────────────────────────────────────────────────
    const { data: receipt, error: receiptError } = await supabaseAdmin
      .from("receipts").select("*").eq("id", receiptId).single();

    if (receiptError || !receipt) {
      return new Response(JSON.stringify({ error: "Receipt not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (receipt.sender_id !== user.id) {
      return new Response(JSON.stringify({ error: "Only the sender can pay" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Fetch fee settings ────────────────────────────────────────────────
    const { data: feeRow } = await supabaseAdmin
      .from("fee_settings").select("fee_percentage, base_fee, fee_cap").limit(1).maybeSingle();

    const feePct  = feeRow ? Number(feeRow.fee_percentage) : DEFAULT_FEE_PCT;
    const baseFee = feeRow ? Number(feeRow.base_fee)       : DEFAULT_BASE_FEE;
    const feeCap  = feeRow ? Number(feeRow.fee_cap)        : DEFAULT_FEE_CAP;

    const protectionFee =
      receipt.protection_fee && Number(receipt.protection_fee) > 0
        ? Number(receipt.protection_fee)
        : calcProtectionFee(Number(receipt.amount), feePct, baseFee, feeCap);

    const receiptAmount = Number(receipt.amount);

    // ── Fetch sender profile (phone + name) ───────────────────────────────
    const { data: senderProfile } = await supabaseAdmin
      .from("profiles")
      .select("phone_number")
      .eq("id", user.id)
      .single();

    // ── Fetch receiver profile (phone only) ───────────────────────────────
    const { data: receiverProfile } = await supabaseAdmin
      .from("profiles")
      .select("phone_number")
      .eq("email", receipt.receiver_email)
      .maybeSingle();

    // ── Resolve phone numbers ─────────────────────────────────────────────
    const senderPhone   = senderProfile?.phone_number   || generateFallbackPhone(user.id);
    const receiverEmailHash = receipt.receiver_email
      .split("").reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0)
      .toString().padStart(8, "0").slice(-8);
    const receiverPhone = receiverProfile?.phone_number || `080${receiverEmailHash}`;

    const payscrowApiKey = Deno.env.get("PAYSCROW_BROKER_API_KEY");
    if (!payscrowApiKey) {
      return new Response(JSON.stringify({ error: "Payscrow not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const transactionRef = `SURER-${receipt.id.slice(0, 8)}-${Date.now()}`;
    const origin = req.headers.get("origin") || "https://surer.com.ng";

    // ── Build Payscrow request ────────────────────────────────────────────
    const requestBody = {
      transactionReference: transactionRef,
      merchantEmailAddress: receipt.receiver_email,
      merchantName:         receipt.receiver_email.split("@")[0], 
      customerEmailAddress: user.email,
      customerName:         user.email!.split("@")[0],            
      customerPhoneNo:      senderPhone,
      merchantPhoneNo:      receiverPhone,
      currencyCode:         "NGN",
      merchantChargePercentage: 100,
      returnUrl:            `${origin}/receipt/${receipt.id}`,
      webhookNotificationUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payscrow-webhook`,
      items: [
        {
          name:        receipt.description,
          description: receipt.description,
          quantity:    1,
          price:       receiptAmount,
        },
        {
          name:        "Surer Protection Fee",
          description: `Escrow protection (${feePct}% + ₦${baseFee} base)`,
          quantity:    1,
          price:       protectionFee,
        },
      ],
    };

    console.log(
      `[create-payment] Receipt ${receiptId}:`,
      `amount=₦${receiptAmount} protectionFee=₦${protectionFee}`,
      `senderPhone=${senderPhone} (real: ${!!senderProfile?.phone_number})`
    );

    const payscrowResponse = await fetch(`${PAYSCROW_API_BASE}/transactions/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", BrokerApiKey: payscrowApiKey },
      body: JSON.stringify(requestBody),
    });

    const payscrowData = await payscrowResponse.json();
    console.log("[create-payment] Payscrow response:", JSON.stringify(payscrowData));

    if (!payscrowResponse.ok || !payscrowData.success) {
      let errorMsg = "Payscrow error";
      if (Array.isArray(payscrowData?.errors))                                       errorMsg = payscrowData.errors.join(", ");
      else if (typeof payscrowData?.errors === "object" && payscrowData.errors)      errorMsg = Object.values(payscrowData.errors).flat().join(", ");
      else if (typeof payscrowData?.errors === "string")                             errorMsg = payscrowData.errors;
      else if (payscrowData?.message)                                                errorMsg = payscrowData.message;

      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Persist transaction refs + confirmed fees ─────────────────────────
    await supabaseAdmin.from("receipts").update({
      payscrow_transaction_ref:    transactionRef,
      payscrow_transaction_number: payscrowData.data.transactionNumber,
      protection_fee:              protectionFee,
    }).eq("id", receiptId);

    return new Response(
      JSON.stringify({
        paymentLink:       payscrowData.data.paymentLink,
        totalPayable:      payscrowData.data.totalPayable,
        transactionNumber: payscrowData.data.transactionNumber,
        protectionFee,
        receiptAmount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[create-payment] Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});