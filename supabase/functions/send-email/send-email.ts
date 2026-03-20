/**
 * send-email.ts — Minimal Resend proxy
 *
 * This is the ONLY email-related edge function.
 * It exists solely to keep the RESEND_API_KEY server-side.
 * All email logic, templates and fallback chain live in src/lib/email.ts.
 *
 * Called by email.ts as the LAST fallback (Resend) when EmailJS and
 * the Nodemailer server have both failed.
 *
 * Expects: { to, subject, html, text? }
 * Returns: { success: true } or { success: false, error: "..." }
 *
 * REQUIRED SECRET: RESEND_API_KEY
 * OPTIONAL SECRET: EMAIL_FROM (defaults to onboarding@resend.dev for testing)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, subject, html, text } = await req.json();

    if (!to || !subject || !html) {
      return new Response(
        JSON.stringify({ success: false, error: "to, subject, html are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(
        JSON.stringify({ success: false, error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const from = `Surer <${Deno.env.get("EMAIL_FROM") || "onboarding@resend.dev"}>`;

    const res = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to:      Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      console.error("[send-email] Resend error:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ success: false, error: data?.message || `HTTP ${res.status}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[send-email] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});