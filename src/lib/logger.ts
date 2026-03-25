/**
 * src/lib/logger.ts
 *
 * USAGE:
 *   import { logger } from "@/lib/logger";
 *
 *   logger.info("auth", "User signed in", { important: true });
 *   logger.warn("email", "EmailJS failed, trying nodemailer", { data: { error } });
 *   logger.error("payscrow-release", "Settlement failed", { data: { receiptId }, userId });
 *
 * DEV  (VITE_ENV=dev or not set):
 *   → Logs to console with colour + timestamp. Never touches the DB.
 *
 * PROD (VITE_ENV=prod):
 *   → No console output. Writes to app_logs table directly via supabase.
 *   → Noise is filtered BEFORE writing — errors caused by bad network,
 *     wrong user input, etc. are silently dropped.
 *   → info only written if { important: true }
 *   → warn and error always written (unless they match noise patterns)
 */

import { supabase } from "@/integrations/supabase/client";

type Level = "info" | "warn" | "error";

interface LogOptions {
  /** Only relevant for info in prod — skips DB write unless true */
  important?: boolean;
  /** Any structured data to attach */
  data?: Record<string, unknown>;
  /** User ID to attach if known */
  userId?: string;
}

// ── Environment ───────────────────────────────────────────────────────────────
const IS_PROD = import.meta.env.VITE_ENV === "prod" || import.meta.env.MODE === "production";

// ── Noise patterns — these are NEVER written to DB in prod ────────────────────
// These cover errors that are caused by the user or their connection,
// not by the app itself. They still show in dev console for debugging.
const NOISE: RegExp[] = [
  /invalid.*(login|credentials|password|pin)/i,
  /incorrect.*(pin|password)/i,
  /failed to fetch/i,
  /networkerror/i,
  /network.*error/i,
  /err_network/i,
  /err_internet/i,
  /load.*failed/i,
  /connection.*refused/i,
  /aborted/i,
  /user.*cancelled/i,
  /user.*denied/i,
  /rate.?limit/i,
  /too many requests/i,
  /not found/i,      // 404 from user navigating to a bad URL
  /probe/i,          // Auth.tsx dummy signIn probe — always noise
];

function isNoise(msg: string): boolean {
  return NOISE.some(p => p.test(msg));
}

// ── Console colours (dev only) ────────────────────────────────────────────────
const C = { info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m", reset: "\x1b[0m" };

function devLog(level: Level, ctx: string, msg: string, data?: unknown) {
  const t  = new Date().toTimeString().slice(0, 8);
  const c  = C[level];
  const r  = C.reset;
  const pre = `${c}[${level.toUpperCase()}]${r} ${t} ${c}[${ctx}]${r}`;
  const fn  = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if(data !== undefined){
     fn(pre, msg, data)
  }else{
    fn(pre, msg)
  }
}

// ── DB write (prod only) ──────────────────────────────────────────────────────
async function writeDB(level: Level, ctx: string, msg: string, opts?: LogOptions) {
  try {
    await supabase.from("app_logs").insert({
      level,
      context:   ctx,
      message:   msg,
      metadata:  opts?.data ?? null,
      user_id:   opts?.userId ?? null,
    });
  } catch {
    // Never let logging break the app
  }
}

// ── Core ──────────────────────────────────────────────────────────────────────
function log(level: Level, ctx: string, msg: string, opts?: LogOptions) {
  if (!IS_PROD) {
    // Dev: always log to console, never to DB
    devLog(level, ctx, msg, opts?.data);
    return;
  }

  // Prod: no console ever.
  // Drop noise silently.
  if (isNoise(msg)) return;

  // info only if important
  if (level === "info" && !opts?.important) return;

  // Non-blocking write
  writeDB(level, ctx, msg, opts);
}

// ── Public API ────────────────────────────────────────────────────────────────
export const logger = {
  /**
   * General info. DB write in prod only if { important: true }.
   * Example: logger.info("payscrow", "Settlement sent", { important: true, data: { receiptId } })
   */
  info: (ctx: string, msg: string, opts?: LogOptions) => log("info", ctx, msg, opts),

  /**
   * Non-fatal unexpected behaviour. Always written to DB in prod (unless noise).
   * Example: logger.warn("email", "EmailJS failed, falling back", { data: { error } })
   */
  warn: (ctx: string, msg: string, opts?: LogOptions) => log("warn", ctx, msg, opts),

  /**
   * Something failed. Always written to DB in prod (unless noise).
   * Example: logger.error("payscrow-release", "All retries failed", { data: { error }, userId })
   */
  error: (ctx: string, msg: string, opts?: LogOptions) => log("error", ctx, msg, opts),
};