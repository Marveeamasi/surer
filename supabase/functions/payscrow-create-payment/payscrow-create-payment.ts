/**
 * payscrow-create-payment.ts
 *
 * ─── THE PAYSCROW FEE PROBLEM & SOLUTION ────────────────────────────────────
 *
 * PROBLEM:
 *   Payscrow ALWAYS adds their own "Transaction Fee" at checkout on top of
 *   the item subtotal. With merchantChargePercentage: 0, the customer bears
 *   this fee, so a ₦1,135 subtotal becomes ₦1,257.70 at checkout. Confusing.
 *
 * SOLUTION — merchantChargePercentage: 100
 *   Set merchantChargePercentage to 100. This means:
 *   • Customer pays EXACTLY the item subtotal (amount + protection_fee). No extra.
 *   • Payscrow deducts THEIR fee from the merchant/settlement side internally.
 *   • At /broker/settle time, Payscrow settles a slightly lower amount to
 *     reflect their charge having been deducted from the pool.
 *
 *   From Payscrow docs (Section 10 - Business Logic):
 *     "merchantChargePercentage: 100 → Merchant pays 100% of escrow charges"
 *     "customerCharge = 0 → customer pays only the transaction amount"
 *     "totalSettlementAmount = amount - merchantCharge"
 *
 *   In practice for Surer:
 *     - The "merchant" in Payscrow's model = the receiver side of the escrow
 *     - The protection_fee we charge covers Payscrow's deduction
 *     - Customer (sender) sees and pays: ₦1,000 + ₦135 = ₦1,135.00 EXACTLY
 *     - Payscrow takes their ~₦XX from the escrowed pool (out of the ₦135)
 *     - We settle receipt.amount to receiver, remainder covers Payscrow's fee
 *
 * ITEMS STRUCTURE:
 *   Two items so the checkout page is transparent and understandable:
 *     Item 1: <receipt description>    → ₦1,000   (escrow amount for receiver)
 *     Item 2: Surer Protection Fee     → ₦135     (our service charge)
 *   Subtotal shown to user:            → ₦1,135   ← FINAL amount, no extras
 *
 * NOTE ON /broker/settle:
 *   We only settle receipt.amount to sender/receiver.
 *   The protection_fee covers Payscrow's charge + remains in the pool.
 *   No admin bank account in settlements — Payscrow takes their cut automatically.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAYSCROW_API_BASE = "https://api.payscrow.net/api/v3/marketplace";

// Fallback fee settings if DB fetch fails
const DEFAULT_FEE_PCT = 3.5;
const DEFAULT_BASE_FEE = 100;
const DEFAULT_FEE_CAP = 2000;

/** Calculate Surer protection fee: (amount × pct / 100) + base, capped at cap */
function calcProtectionFee(
  amount: number,
  pct: number,
  base: number,
  cap: number
): number {
  const raw = (amount * pct) / 100 + base;
  return Math.min(raw, cap);
}

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

    const { receiptId } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Fetch receipt ─────────────────────────────────────────────────────
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
      return new Response(
        JSON.stringify({ error: "Only the sender can pay" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Fetch admin fee settings from DB ──────────────────────────────────
    const { data: feeRow } = await supabaseAdmin
      .from("fee_settings")
      .select("fee_percentage, base_fee, fee_cap")
      .limit(1)
      .maybeSingle();

    const feePct  = feeRow ? Number(feeRow.fee_percentage) : DEFAULT_FEE_PCT;
    const baseFee = feeRow ? Number(feeRow.base_fee)       : DEFAULT_BASE_FEE;
    const feeCap  = feeRow ? Number(feeRow.fee_cap)        : DEFAULT_FEE_CAP;

    // ── Determine protection fee ──────────────────────────────────────────
    // Use the value stored at receipt-creation time for consistency.
    // Recalculate only if it was never stored (e.g. very old receipts).
    const protectionFee =
      receipt.protection_fee && Number(receipt.protection_fee) > 0
        ? Number(receipt.protection_fee)
        : calcProtectionFee(Number(receipt.amount), feePct, baseFee, feeCap);

    const receiptAmount = Number(receipt.amount);

    const { data: senderProfile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    const payscrowApiKey = Deno.env.get("PAYSCROW_BROKER_API_KEY");
    if (!payscrowApiKey) {
      return new Response(
        JSON.stringify({ error: "Payscrow not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const transactionRef = `SURER-${receipt.id.slice(0, 8)}-${Date.now()}`;
    const origin = req.headers.get("origin") || "https://surer.com.ng";

    // ── Build Payscrow request ────────────────────────────────────────────
    //
    // KEY SETTING: merchantChargePercentage = 100
    //   This makes Payscrow charge the MERCHANT side 100% of their fee,
    //   meaning the CUSTOMER (sender) pays EXACTLY the item subtotal with
    //   NO extra "Transaction Fee" line added at checkout.
    //
    //   Payscrow deducts their fee from the escrowed pool internally.
    //   The protection_fee we include as Item 2 is what covers this deduction.
    //
    //   Checkout display the user sees:
    //     [description] ............. ₦1,000.00
    //     Surer Protection Fee ....... ₦135.00
    //     ─────────────────────────────────────
    //     Total to Pay .............. ₦1,135.00   ← EXACT, no surprise charges
    //
    // TWO ITEMS for transparency:
    //   Item 1 = receipt amount  (what goes to receiver in escrow)
    //   Item 2 = protection fee  (Surer's escrow protection charge)
    //
    // NO settlementAccounts — we defer all settlement to /broker/settle.
    const requestBody = {
      transactionReference: transactionRef,
      merchantEmailAddress: receipt.receiver_email,
      merchantName: receipt.receiver_email.split("@")[0],
      customerEmailAddress: user.email,
      customerName:
        senderProfile?.display_name || user.email!.split("@")[0],
      customerPhoneNo: "08093760021", // Required by Payscrow
      merchantPhoneNo: "08093760021", // Required by Payscrow
      currencyCode: "NGN",
      // ▼ THE FIX: merchant bears Payscrow's fee → customer pays exact subtotal
      merchantChargePercentage: 100,
      returnUrl: `${origin}/receipt/${receipt.id}`,
      webhookNotificationUrl: `${Deno.env.get(
        "SUPABASE_URL"
      )}/functions/v1/payscrow-webhook`,
      items: [
        {
          // The actual escrow amount — settled to receiver (or refunded) at decision
          name: receipt.description,
          description: receipt.description,
          quantity: 1,
          price: receiptAmount,
        },
        {
          // Surer's protection fee — absorbs Payscrow's internal charge
          // So the sender's total = receiptAmount + protectionFee. Nothing more.
          name: "Surer Protection Fee",
          description: `Escrow protection (${feePct}% + ₦${baseFee} base)`,
          quantity: 1,
          price: protectionFee,
        },
      ],
      // No settlementAccounts — money stays in escrow until /broker/settle
    };

    console.log(
      `[create-payment] Receipt ${receiptId}:`,
      `amount=₦${receiptAmount}`,
      `protectionFee=₦${protectionFee}`,
      `subtotal=₦${receiptAmount + protectionFee}`,
      `merchantChargePercentage=100 (sender pays exact subtotal)`
    );

    const payscrowResponse = await fetch(
      `${PAYSCROW_API_BASE}/transactions/start`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          BrokerApiKey: payscrowApiKey,
        },
        body: JSON.stringify(requestBody),
      }
    );

    const payscrowData = await payscrowResponse.json();
    console.log(
      "[create-payment] Payscrow response:",
      JSON.stringify(payscrowData)
    );

    if (!payscrowResponse.ok || !payscrowData.success) {
      let errorMsg = "Payscrow error";
      if (Array.isArray(payscrowData?.errors)) {
        errorMsg = payscrowData.errors.join(", ");
      } else if (
        typeof payscrowData?.errors === "object" &&
        payscrowData.errors !== null
      ) {
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

    // ── Persist transaction refs + confirmed protection_fee ───────────────
    // Also null out deprecated surer_fee / payscrow_fee columns
    await supabaseAdmin
      .from("receipts")
      .update({
        payscrow_transaction_ref: transactionRef,
        payscrow_transaction_number: payscrowData.data.transactionNumber,
        protection_fee: protectionFee,
        surer_fee: null,    // Deprecated — replaced by protection_fee
        payscrow_fee: null, // Deprecated — replaced by protection_fee
      })
      .eq("id", receiptId);

    return new Response(
      JSON.stringify({
        paymentLink: payscrowData.data.paymentLink,
        // totalPayable from Payscrow = our subtotal since customer charge = 0
        totalPayable: payscrowData.data.totalPayable,
        transactionNumber: payscrowData.data.transactionNumber,
        protectionFee,
        receiptAmount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[create-payment] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});