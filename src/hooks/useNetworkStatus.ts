/**
 * src/hooks/useNetworkStatus.ts
 *
 * Detects three states:
 *   offline  — no internet connection at all
 *   poor     — connected but slow (2G/slow-2g via Network Information API,
 *               or RTT > 500ms, or downlink < 0.5 Mbps)
 *   good     — normal connection
 *
 * Uses the Network Information API (supported on Android Chrome, some desktop)
 * with a ping-based fallback for browsers that don't support it (Safari, Firefox).
 *
 * USAGE:
 *   const { status, isOffline, isPoor } = useNetworkStatus();
 *
 * The NetworkStatusBanner component (below) uses this hook automatically.
 * Just drop <NetworkStatusBanner /> into your AppLayout and it handles everything.
 */

import { useState, useEffect, useCallback } from "react";

export type NetworkStatus = "good" | "poor" | "offline";

interface NetworkState {
  status:    NetworkStatus;
  isOffline: boolean;
  isPoor:    boolean;
  isGood:    boolean;
}

// ── Ping test to measure actual connectivity ───────────────────────────────
// Fetches a tiny known-fast resource and measures round-trip time.
// We use supabase health endpoint so it's always reachable if auth works.
const PING_URL = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/?apikey=${import.meta.env.VITE_SUPABASE_ANON_KEY}`;
const PING_TIMEOUT_MS  = 3000;  // if no response in 3s → poor
const POOR_RTT_MS      = 1500;  // RTT above this = poor
const PING_INTERVAL_MS = 15000; // re-check every 15 seconds

async function measureRTT(): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    const start      = performance.now();

    await fetch(PING_URL, {
      method: "HEAD",
      signal: controller.signal,
      cache:  "no-store",
    });

    clearTimeout(timer);
    return performance.now() - start;
  } catch {
    return null; // aborted or failed
  }
}

function getStatusFromNetworkInfo(): NetworkStatus | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  if (!conn) return null;

  const { effectiveType, downlink, rtt } = conn;

  if (effectiveType === "slow-2g" || effectiveType === "2g") return "poor";
  if (rtt    && rtt     > 500)  return "poor";
  if (downlink && downlink < 0.5) return "poor";
  return "good";
}

export function useNetworkStatus(): NetworkState {
  const [status, setStatus] = useState<NetworkStatus>("good");

  const check = useCallback(async () => {
    // 1. Check navigator.onLine first — instant
    if (!navigator.onLine) {
      setStatus("offline");
      return;
    }

    // 2. Try Network Information API — zero cost, works on Android Chrome
    const fromApi = getStatusFromNetworkInfo();
    if (fromApi) {
      setStatus(fromApi);
      return;
    }

    // 3. Fallback: ping test — measures real RTT
    const rtt = await measureRTT();

    if (rtt === null) {
      // Couldn't reach server — could be offline or very poor
      setStatus(navigator.onLine ? "poor" : "offline");
    } else if (rtt > POOR_RTT_MS) {
      setStatus("poor");
    } else {
      setStatus("good");
    }
  }, []);

  useEffect(() => {
    // Initial check
    check();

    // Online/offline events — instant signal
    const handleOnline  = () => { check(); };
    const handleOffline = () => { setStatus("offline"); };

    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);

    // Network Information API change event
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = (navigator as any).connection;
    if (conn) conn.addEventListener("change", check);

    // Periodic re-check (catches gradual degradation)
    const interval = setInterval(check, PING_INTERVAL_MS);

    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (conn) conn.removeEventListener("change", check);
      clearInterval(interval);
    };
  }, [check]);

  return {
    status,
    isOffline: status === "offline",
    isPoor:    status === "poor",
    isGood:    status === "good",
  };
}