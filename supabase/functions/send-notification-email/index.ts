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
    const { type, receiptId, decision, reason, decidedBy } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
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

    const decisionLabels: Record<string, string> = {
      release_all: "Release Full Payment",
      release_specific: "Release Specific Amount",
      refund: "Full Refund",
      delivered: "Marked as Delivered",
      accept: "Accepted the proposal",
      reject: "Rejected the proposal",
    };

    const baseStyle = `
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 480px; margin: 0 auto; padding: 32px 24px;
      background: #f8fafb; border-radius: 12px;
    `;
    const headerStyle = `color: #1a3a4a; font-size: 22px; font-weight: 700; margin-bottom: 16px;`;
    const textStyle = `color: #4a6a7a; font-size: 14px; line-height: 1.6;`;
    const badgeStyle = `display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;`;
    const btnStyle = `display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #4a8a9a, #3a7a5a); color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;`;

    const templates: Record<string, { subject: string; to: string[]; html: string }> = {
      receipt_created: {
        subject: `💳 New Surer Receipt: ${receipt.description}`,
        to: [receiverEmail],
        html: `<div style="${baseStyle}">
          <h2 style="${headerStyle}">New Receipt Created</h2>
          <p style="${textStyle}"><strong>Amount:</strong> ${formatNaira(receipt.amount)}</p>
          <p style="${textStyle}"><strong>Description:</strong> ${receipt.description}</p>
          <p style="${textStyle}"><strong>From:</strong> ${senderEmail}</p>
          <p style="${textStyle}">Log in to Surer to view and manage this receipt.</p>
          <p style="text-align: center; margin-top: 24px;">
            <a href="https://surer.lovable.app/dashboard" style="${btnStyle}">View on Surer</a>
          </p>
        </div>`,
      },
      payment_confirmed: {
        subject: `✅ Payment Confirmed: ${receipt.description}`,
        to: [senderEmail, receiverEmail].filter(Boolean),
        html: `<div style="${baseStyle}">
          <h2 style="${headerStyle}">Payment Confirmed! 🎉</h2>
          <p style="${textStyle}">The payment of ${formatNaira(receipt.amount)} for "${receipt.description}" has been confirmed and is now held safely in escrow.</p>
          <p style="${textStyle}">Both parties can now make decisions on this receipt.</p>
          <p style="text-align: center; margin-top: 24px;">
            <a href="https://surer.lovable.app/receipt/${receipt.id}" style="${btnStyle}">View Receipt</a>
          </p>
        </div>`,
      },
      decision_made: {
        subject: `⚡ Decision Update: ${receipt.description}`,
        to: decidedBy === "sender" ? [receiverEmail] : [senderEmail],
        html: `<div style="${baseStyle}">
          <h2 style="${headerStyle}">A Decision Has Been Made</h2>
          <p style="${textStyle}"><strong>Receipt:</strong> ${receipt.description} (${formatNaira(receipt.amount)})</p>
          <p style="${textStyle}"><strong>Decision:</strong> <span style="${badgeStyle} background: #e0f2e9; color: #2a6a4a;">${decisionLabels[decision] || decision}</span></p>
          ${reason ? `<p style="${textStyle}"><strong>Reason:</strong> "${reason}"</p>` : ""}
          <p style="${textStyle}">You have 2 days to respond before this decision is auto-executed.</p>
          <p style="text-align: center; margin-top: 24px;">
            <a href="https://surer.lovable.app/receipt/${receipt.id}" style="${btnStyle}">Respond Now</a>
          </p>
        </div>`,
      },
      dispute_started: {
        subject: `⚠️ Dispute Raised: ${receipt.description}`,
        to: [senderEmail, receiverEmail].filter(Boolean),
        html: `<div style="${baseStyle}">
          <h2 style="${headerStyle}">Dispute Raised</h2>
          <p style="${textStyle}">A dispute has been raised on "${receipt.description}" (${formatNaira(receipt.amount)}).</p>
          <p style="${textStyle}">You have <strong>4 days</strong> to resolve this before it escalates to admin review.</p>
          <p style="text-align: center; margin-top: 24px;">
            <a href="https://surer.lovable.app/receipt/${receipt.id}" style="${btnStyle}">View Dispute</a>
          </p>
        </div>`,
      },
      dispute_escalated: {
        subject: `🚨 Dispute Escalated: ${receipt.description}`,
        to: [senderEmail, receiverEmail].filter(Boolean),
        html: `<div style="${baseStyle}">
          <h2 style="${headerStyle}">Dispute Escalated to Admin</h2>
          <p style="${textStyle}">The dispute on "${receipt.description}" (${formatNaira(receipt.amount)}) has been unresolved for 4 days.</p>
          <p style="${textStyle}">It has been escalated to an admin for a final decision. Both parties can no longer make decisions.</p>
        </div>`,
      },
      dispute_resolved: {
        subject: `✅ Resolved: ${receipt.description}`,
        to: [senderEmail, receiverEmail].filter(Boolean),
        html: `<div style="${baseStyle}">
          <h2 style="${headerStyle}">Receipt Completed ✅</h2>
          <p style="${textStyle}">The receipt "${receipt.description}" (${formatNaira(receipt.amount)}) has been resolved and completed.</p>
          <p style="${textStyle}">Funds are being processed according to the final decision.</p>
          <p style="text-align: center; margin-top: 24px;">
            <a href="https://surer.lovable.app/receipt/${receipt.id}" style="${btnStyle}">View Outcome</a>
          </p>
        </div>`,
      },
      withdrawal_success: {
        subject: `💰 Withdrawal Processed`,
        to: [receiverEmail],
        html: `<div style="${baseStyle}">
          <h2 style="${headerStyle}">Withdrawal Processed! 💰</h2>
          <p style="${textStyle}">Your withdrawal for receipt "${receipt.description}" has been processed.</p>
          <p style="${textStyle}">Funds should arrive in your bank account shortly.</p>
        </div>`,
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
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: "Surer <onboarding@resend.dev>",
        to: template.to.filter(Boolean),
        subject: template.subject,
        html: template.html,
      }),
    });

    const emailResult = await emailResponse.json();
    console.log("Email sent:", type, "result:", JSON.stringify(emailResult));

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
