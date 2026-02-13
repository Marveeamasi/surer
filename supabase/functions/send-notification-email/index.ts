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
    const { type, receiptId } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: "Resend not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch receipt
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

    // Get sender and receiver emails
    const { data: sender } = await supabaseAdmin.auth.admin.getUserById(receipt.sender_id);
    const senderEmail = sender?.user?.email || "";
    const receiverEmail = receipt.receiver_email;

    const formatNaira = (amt: number) =>
      new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(amt);

    const templates: Record<string, { subject: string; to: string[]; html: string }> = {
      receipt_created: {
        subject: `New Receipt: ${receipt.description}`,
        to: [receiverEmail],
        html: `
          <h2>You have a new Surer receipt!</h2>
          <p><strong>Amount:</strong> ${formatNaira(receipt.amount)}</p>
          <p><strong>Description:</strong> ${receipt.description}</p>
          <p><strong>From:</strong> ${senderEmail}</p>
          <p>Log in to Surer to view and manage this receipt.</p>
        `,
      },
      payment_confirmed: {
        subject: `Payment Confirmed: ${receipt.description}`,
        to: [senderEmail, receiverEmail],
        html: `
          <h2>Payment Confirmed! 🎉</h2>
          <p>The payment of ${formatNaira(receipt.amount)} for "${receipt.description}" has been confirmed and is now held safely in escrow.</p>
          <p>The sender can release the funds once satisfied.</p>
        `,
      },
      dispute_started: {
        subject: `Dispute Started: ${receipt.description}`,
        to: [senderEmail, receiverEmail],
        html: `
          <h2>A dispute has been raised</h2>
          <p>A dispute has been raised on the receipt "${receipt.description}" (${formatNaira(receipt.amount)}).</p>
          <p>Please log in to Surer to respond or provide evidence.</p>
        `,
      },
      dispute_resolved: {
        subject: `Dispute Resolved: ${receipt.description}`,
        to: [senderEmail, receiverEmail],
        html: `
          <h2>Dispute Resolved ✅</h2>
          <p>The dispute on "${receipt.description}" has been resolved.</p>
          <p>Log in to Surer to see the outcome.</p>
        `,
      },
      withdrawal_success: {
        subject: `Withdrawal Successful`,
        to: [receiverEmail],
        html: `
          <h2>Withdrawal Successful! 💰</h2>
          <p>Your withdrawal of ${formatNaira(receipt.amount)} has been processed.</p>
          <p>Funds should arrive in your bank account shortly.</p>
        `,
      },
    };

    const template = templates[type];
    if (!template) {
      return new Response(JSON.stringify({ error: "Unknown notification type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send via Resend
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: "Surer <notifications@surer.ng>",
        to: template.to.filter(Boolean),
        subject: template.subject,
        html: template.html,
      }),
    });

    const emailResult = await emailResponse.json();

    return new Response(
      JSON.stringify({ success: true, data: emailResult }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Email error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
