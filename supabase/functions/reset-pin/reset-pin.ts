/**
 * reset-pin.ts
 *
 * EMAIL_SERVICE secret (Supabase → Settings → Edge Functions → Secrets):
 *   nodemailer  → calls your Vercel Nodemailer server (default)
 *   resend      → calls send-email edge function (which uses Resend)
 *
 * OTHER REQUIRED SECRETS:
 *   APP_URL              = https://surer.com.ng
 *   EMAIL_SERVER_URL     = https://your-email-server.vercel.app/api/send
 *   EMAIL_SERVER_SECRET  = the secret you set on your Vercel server
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const shell = (body: string) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f5;padding:32px 16px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;">
    <div style="background:#18181b;padding:24px 32px;text-align:center;">
      <span style="color:#fff;font-size:22px;font-weight:800;">Surer</span>
    </div>
    <div style="padding:32px;">${body}</div>
    <div style="padding:16px 32px;background:#f9f9f9;border-top:1px solid #eee;text-align:center;font-size:12px;color:#aaa;">
      Surer · Safe escrow payments for Nigerians
    </div>
  </div>
</div>`;

// ── Send via Nodemailer Vercel server ─────────────────────────────────────────
async function sendViaNodemailer(
  to: string, subject: string, html: string, text: string
): Promise<{ success: boolean; error?: string }> {
  const serverUrl = Deno.env.get("EMAIL_SERVER_URL");
  const secret    = Deno.env.get("EMAIL_SERVER_SECRET") || "";

  if (!serverUrl) {
    return { success: false, error: "EMAIL_SERVER_URL secret not set" };
  }

  try {
    const res = await fetch(serverUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ to, subject, html, text, secret }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return { success: true };
    return { success: false, error: data.error || `HTTP ${res.status}` };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ── Send via Resend (calls send-email edge function) ──────────────────────────
async function sendViaResend(
  to: string, subject: string, html: string, text: string,
  supabaseUrl: string, serviceKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ to, subject, html, text }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return { success: true };
    return { success: false, error: data.error || `HTTP ${res.status}` };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailLower  = email.trim().toLowerCase();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const appUrl      = (Deno.env.get("APP_URL") || "https://surer.com.ng").replace(/\/$/, "");

    // EMAIL_SERVICE: "nodemailer" (default) or "resend"
    const emailService = (Deno.env.get("EMAIL_SERVICE") || "nodemailer").toLowerCase();

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    console.log(`[reset-pin] Generating link for: ${emailLower}`);

    // ── Generate signed recovery link (no email sent by Supabase) ────────────
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type:    "recovery",
      email:   emailLower,
      options: { redirectTo: `${appUrl}/auth?mode=reset` },
    });

    if (error) {
      console.error("[reset-pin] generateLink error:", error.message);
      // Generic response — don't reveal if email exists
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resetLink = data?.properties?.action_link;
    if (!resetLink) {
      return new Response(
        JSON.stringify({ error: "Could not generate reset link." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Build email content ───────────────────────────────────────────────────
    const subject = "Reset your Surer PIN";
    const text    = `Reset your Surer PIN: ${resetLink}\n\nExpires in 1 hour. If you didn't request this, ignore this email.`;
    const html    = shell(`
      <h2 style="font-size:20px;font-weight:700;color:#111;margin:0 0 16px;">Reset your PIN</h2>
      <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 12px;">
        Someone requested a PIN reset for your Surer account.
        Click the button below to set a new PIN.
      </p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${resetLink}"
           style="display:inline-block;padding:13px 32px;background:#18181b;
                  color:#fff;text-decoration:none;border-radius:10px;
                  font-weight:700;font-size:15px;">
          Reset my PIN
        </a>
      </p>
      <p style="font-size:13px;color:#888;line-height:1.6;">
        Expires in <strong>1 hour</strong>.
        Didn't request this? Ignore this email — your PIN stays unchanged.
      </p>
    `);

    // ── Send with fallback ────────────────────────────────────────────────────
    const primary   = emailService === "resend" ? "resend" : "nodemailer";
    const secondary = primary === "nodemailer" ? "resend" : "nodemailer";

    console.log(`[reset-pin] Sending via ${primary} (fallback: ${secondary})`);

    const send = async (service: string) =>
      service === "nodemailer"
        ? sendViaNodemailer(emailLower, subject, html, text)
        : sendViaResend(emailLower, subject, html, text, supabaseUrl, serviceKey);

    let result = await send(primary);

    if (!result.success) {
      console.warn(`[reset-pin] ${primary} failed: ${result.error} — trying ${secondary}`);
      result = await send(secondary);
    }

    if (!result.success) {
      console.error(`[reset-pin] Both services failed: ${result.error}`);
      return new Response(
        JSON.stringify({ error: "Failed to send reset email. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[reset-pin] Reset email sent to ${emailLower} via ${primary}`);
    return new Response(
      JSON.stringify({ success: true, message: "Reset link sent to your email." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[reset-pin] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});