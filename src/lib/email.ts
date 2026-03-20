/**
 * src/lib/email.ts
 *
 * Central email library. One export: sendEmail()
 * Never throws. Always tries fallbacks in order.
 *
 * DELIVERY ORDER (based on VITE_EMAIL_SERVICE, default: emailjs):
 *   1. EmailJS       → client-side, free 200/month, no server needed
 *   2. Nodemailer    → your Vercel-hosted Node server
 *   3. Resend        → via send-email edge function (keeps API key server-side)
 *
 * If primary fails → tries next → tries next → logs and returns.
 * Settlement, decisions, and all user flows are NEVER blocked by email failure.
 *
 * ENV VARS NEEDED (.env):
 *   VITE_EMAIL_SERVICE=emailjs          (or nodemailer or resend)
 *   VITE_APP_URL=https://surer.com.ng
 *
 *   EmailJS:
 *     VITE_EMAILJS_SERVICE_ID=service_xxxxxxx
 *     VITE_EMAILJS_TEMPLATE_ID=template_xxxxxxx
 *     VITE_EMAILJS_PUBLIC_KEY=xxxxxxxxxxxxxxx
 *
 *   Nodemailer server:
 *     VITE_EMAIL_SERVER_URL=https://your-server.vercel.app/api/send
 *     VITE_EMAIL_SERVER_SECRET=your_random_secret
 *
 *   Resend: key lives in Supabase secrets as RESEND_API_KEY (never in .env)
 */

import emailjs from "@emailjs/browser";
import { supabase } from "@/integrations/supabase/client";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  templateParams?: Record<string, string>;
}

export interface EmailResult {
  success: boolean;
  service: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config (reads from .env)
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  primary:   (import.meta.env.VITE_EMAIL_SERVICE || "emailjs") as string,
  emailjs: {
    serviceId:  import.meta.env.VITE_EMAILJS_SERVICE_ID  || "",
    templateId: import.meta.env.VITE_EMAILJS_TEMPLATE_ID || "",
    publicKey:  import.meta.env.VITE_EMAILJS_PUBLIC_KEY  || "",
  },
  nodemailer: {
    serverUrl: import.meta.env.VITE_EMAIL_SERVER_URL    || "",
    secret:    import.meta.env.VITE_EMAIL_SERVER_SECRET || "",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Service: EmailJS
// ─────────────────────────────────────────────────────────────────────────────

async function tryEmailJS(opts: EmailOptions): Promise<EmailResult> {
  const { serviceId, templateId, publicKey } = CONFIG.emailjs;

  if (!serviceId || !templateId || !publicKey) {
    return { success: false, service: "emailjs", error: "EmailJS not configured in .env" };
  }

  try {
    const result = await emailjs.send(
      serviceId,
      templateId,
      {
        to_email:     opts.to,
        subject:      opts.subject,
        html_content: opts.html,
        message:      opts.text || opts.html.replace(/<[^>]+>/g, ""),
        reply_to:     "noreply@surer.com.ng",
        ...(opts.templateParams || {}),
      },
      publicKey
    );

    if (result.status === 200) {
      console.log("[email] ✓ EmailJS delivered to", opts.to);
      return { success: true, service: "emailjs" };
    }
    return { success: false, service: "emailjs", error: `Status ${result.status}: ${result.text}` };
  } catch (err: any) {
    return { success: false, service: "emailjs", error: err?.text || String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Service: Nodemailer (your Vercel server)
// ─────────────────────────────────────────────────────────────────────────────

async function tryNodemailer(opts: EmailOptions): Promise<EmailResult> {
  const { serverUrl, secret } = CONFIG.nodemailer;

  if (!serverUrl) {
    return { success: false, service: "nodemailer", error: "VITE_EMAIL_SERVER_URL not set" };
  }

  try {
    const res = await fetch(serverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to:      opts.to,
        subject: opts.subject,
        html:    opts.html,
        text:    opts.text,
        secret,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success) {
      console.log("[email] ✓ Nodemailer delivered to", opts.to);
      return { success: true, service: "nodemailer" };
    }
    return { success: false, service: "nodemailer", error: data.error || `HTTP ${res.status}` };
  } catch (err: any) {
    return { success: false, service: "nodemailer", error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Service: Resend (via send-email edge function)
// ─────────────────────────────────────────────────────────────────────────────

async function tryResend(opts: EmailOptions): Promise<EmailResult> {
  try {
    const { data, error } = await supabase.functions.invoke("send-email", {
      body: {
        to:      opts.to,
        subject: opts.subject,
        html:    opts.html,
        text:    opts.text,
      },
    });

    if (error) return { success: false, service: "resend", error: error.message };
    if (!data?.success) return { success: false, service: "resend", error: data?.error || "Unknown" };

    console.log("[email] ✓ Resend delivered to", opts.to);
    return { success: true, service: "resend" };
  } catch (err: any) {
    return { success: false, service: "resend", error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: sendEmail — tries all services, never throws
// ─────────────────────────────────────────────────────────────────────────────

type ServiceName = "emailjs" | "nodemailer" | "resend";

const ALL: ServiceName[] = ["emailjs", "nodemailer", "resend"];

const FN: Record<ServiceName, (o: EmailOptions) => Promise<EmailResult>> = {
  emailjs:    tryEmailJS,
  nodemailer: tryNodemailer,
  resend:     tryResend,
};

export async function sendEmail(opts: EmailOptions): Promise<EmailResult> {
  const primary  = CONFIG.primary as ServiceName;
  const order    = [primary, ...ALL.filter(s => s !== primary)];
  const errors: string[] = [];

  for (const name of order) {
    try {
      const result = await FN[name](opts);
      if (result.success) return result;
      errors.push(`${name}: ${result.error}`);
      console.warn("[email] ✗", name, "failed:", result.error, "→ trying next");
    } catch (err) {
      errors.push(`${name}: threw`);
      console.warn("[email] ✗", name, "threw:", err);
    }
  }

  console.error("[email] All services failed:", errors.join(" | "));
  return { success: false, service: "none", error: errors.join(" | ") };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-built templates used by Auth and ReceiptView
// ─────────────────────────────────────────────────────────────────────────────

const APP_URL = import.meta.env.VITE_APP_URL || "https://surer.com.ng";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n);

const shell = (body: string) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f5;padding:32px 16px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:#18181b;padding:24px 32px;text-align:center;">
      <span style="color:#fff;font-size:22px;font-weight:800;">Surer</span>
    </div>
    <div style="padding:32px;">${body}</div>
    <div style="padding:16px 32px;background:#f9f9f9;border-top:1px solid #eee;text-align:center;font-size:12px;color:#aaa;">
      Surer · Safe escrow payments for Nigerians
    </div>
  </div>
</div>`;

const h2  = (t: string) => `<h2 style="font-size:20px;font-weight:700;color:#111;margin:0 0 16px;">${t}</h2>`;
const p   = (t: string) => `<p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 12px;">${t}</p>`;
const btn = (label: string, url: string) =>
  `<p style="text-align:center;margin:24px 0 0;">
    <a href="${url}" style="display:inline-block;padding:13px 32px;background:#18181b;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;">${label}</a>
  </p>`;

// Verification email (sent after signup)
export function buildVerificationEmail(token: string): Omit<EmailOptions, "to"> {
  const link = `${APP_URL}/auth?mode=verify&token=${token}`;
  return {
    subject: "Verify your Surer account",
    templateParams: { link, type: "verify" },
    text: `Verify your Surer account: ${link}\n\nExpires in 24 hours.`,
    html: shell(
      h2("Verify your email") +
      p("Welcome to Surer! Click below to verify your email and activate your account.") +
      btn("Verify my email", link) +
      p('<span style="font-size:13px;color:#888;">Expires in 24 hours. Didn\'t sign up? Ignore this.</span>')
    ),
  };
}

// PIN reset email
export function buildResetPinEmail(resetLink: string): Omit<EmailOptions, "to"> {
  return {
    subject: "Reset your Surer PIN",
    templateParams: { link: resetLink, type: "reset" },
    text: `Reset your Surer PIN: ${resetLink}\n\nExpires in 1 hour.`,
    html: shell(
      h2("Reset your PIN") +
      p("Someone requested a PIN reset for your Surer account. Click below to set a new PIN.") +
      btn("Reset my PIN", resetLink) +
      p('<span style="font-size:13px;color:#888;">Expires in 1 hour. Didn\'t request this? Ignore it.</span>')
    ),
  };
}

// Decision notification
export function buildDecisionEmail(
  desc: string, amount: number, receiptId: string,
  decisionType: string, decidedBy: "sender" | "receiver", reason?: string
): Omit<EmailOptions, "to"> {
  const labels: Record<string, string> = {
    release_all: "Release full payment", release_specific: "Release specific amount",
    refund: "Full refund", delivered: "Marked as delivered",
    accept: "Accepted proposal", reject: "Rejected proposal",
  };
  const url = `${APP_URL}/receipt/${receiptId}`;
  return {
    subject: `Action needed — ${desc}`,
    text: `A decision was made on "${desc}". View: ${url}`,
    html: shell(
      h2("A decision was made ⚡") +
      p(`<strong>${desc}</strong> · ${fmt(amount)}`) +
      p(`<strong>Decision:</strong> ${labels[decisionType] || decisionType}`) +
      (reason ? p(`<strong>Reason:</strong> "${reason}"`) : "") +
      p("You have at least <strong>48 hours</strong> to respond before auto-execution.") +
      btn("Respond Now", url)
    ),
  };
}

// Dispute started
export function buildDisputeEmail(
  desc: string, amount: number, receiptId: string
): Omit<EmailOptions, "to"> {
  const url = `${APP_URL}/receipt/${receiptId}`;
  return {
    subject: `⚠️ Dispute raised — ${desc}`,
    text: `A dispute was raised on "${desc}". Resolve within 4 days: ${url}`,
    html: shell(
      h2("A dispute has been raised") +
      p(`<strong>${desc}</strong> · ${fmt(amount)}`) +
      p("You have <strong>4 days</strong> to resolve this before it goes to admin review.") +
      btn("View Dispute", url)
    ),
  };
}

// Receipt completed
export function buildCompletedEmail(
  desc: string, amount: number, receiptId: string, decisionType: string
): Omit<EmailOptions, "to"> {
  const labels: Record<string, string> = {
    release_all: "Full payment released to receiver",
    release_specific: "Partial payment released",
    refund: "Full refund sent to sender",
  };
  const url = `${APP_URL}/receipt/${receiptId}`;
  return {
    subject: `✅ Completed — ${desc}`,
    text: `Your Surer receipt "${desc}" is complete. View: ${url}`,
    html: shell(
      h2("Receipt completed ✅") +
      p(`<strong>${desc}</strong> · ${fmt(amount)}`) +
      p(`<strong>Outcome:</strong> ${labels[decisionType] || "Settled"}`) +
      p("Funds are being sent to bank accounts via Payscrow.") +
      btn("View Receipt", url)
    ),
  };
}

// Missing bank details
export function buildMissingBankEmail(
  desc: string, amount: number, party: "sender" | "receiver"
): Omit<EmailOptions, "to"> {
  const type = party === "receiver" ? "payment" : "refund";
  return {
    subject: "Action needed — add your bank details",
    text: `A ${type} of ${fmt(amount)} is ready for you. Add bank details: ${APP_URL}/settings`,
    html: shell(
      h2(`Add your bank details to receive your ${type} 🏦`) +
      p(`A ${type} of <strong>${fmt(amount)}</strong> for <strong>${desc}</strong> is ready to be sent to you.`) +
      p("Add your bank account in Settings. Settlement will process automatically once added.") +
      btn("Add Bank Details", `${APP_URL}/settings`)
    ),
  };
}