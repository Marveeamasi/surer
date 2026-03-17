import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PAYSCROW_API_BASE = "https://api.payscrow.net/api/v3";
const CACHE_TTL_HOURS   = 24;

const FALLBACK_BANKS = [
  { name: "Access Bank",                        code: "044" },
  { name: "Citibank Nigeria",                   code: "023" },
  { name: "Ecobank Nigeria",                    code: "050" },
  { name: "Fidelity Bank",                      code: "070" },
  { name: "First Bank of Nigeria",              code: "011" },
  { name: "First City Monument Bank (FCMB)",    code: "214" },
  { name: "Guaranty Trust Bank (GTBank)",       code: "058" },
  { name: "Jaiz Bank",                          code: "301" },
  { name: "Keystone Bank",                      code: "082" },
  { name: "Kuda Bank",                          code: "090267" },
  { name: "Moniepoint MFB",                     code: "50515" },
  { name: "OPay Digital Services",              code: "100004" },
  { name: "PalmPay",                            code: "100033" },
  { name: "Polaris Bank",                       code: "076" },
  { name: "Providus Bank",                      code: "101" },
  { name: "Stanbic IBTC Bank",                  code: "221" },
  { name: "Standard Chartered Bank",            code: "068" },
  { name: "Sterling Bank",                      code: "232" },
  { name: "Titan Trust Bank",                   code: "102" },
  { name: "Union Bank of Nigeria",              code: "032" },
  { name: "United Bank for Africa (UBA)",       code: "033" },
  { name: "Unity Bank",                         code: "215" },
  { name: "VFD Microfinance Bank",              code: "090110" },
  { name: "Wema Bank",                          code: "035" },
  { name: "Zenith Bank",                        code: "057" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const payscrowApiKey = Deno.env.get("PAYSCROW_BROKER_API_KEY");

    // ── 1. Check cache ─────────────────────────────────────────────────────
    const { data: cached } = await supabaseAdmin
      .from("bank_list_cache")
      .select("banks, updated_at")
      .eq("id", 1)
      .maybeSingle();

    const cacheAge = cached?.updated_at
      ? (Date.now() - new Date(cached.updated_at).getTime()) / (1000 * 60 * 60)
      : Infinity;

    if (cached && cacheAge < CACHE_TTL_HOURS) {
      // Cache is fresh — return immediately
      return new Response(
        JSON.stringify({ success: true, banks: cached.banks, source: "cache" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Fetch from Payscrow ─────────────────────────────────────────────
    if (!payscrowApiKey) {
      // No API key — return cache if stale, or fallback
      const banks = cached?.banks || FALLBACK_BANKS;
      return new Response(
        JSON.stringify({ success: true, banks, source: cached ? "stale_cache" : "fallback" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let freshBanks: any[] = [];
    let fetchSuccess = false;

    try {
      const res = await fetch(
        `${PAYSCROW_API_BASE}/payments/banks/broker/supported-banks`,
        {
          method: "GET",
          headers: { BrokerApiKey: payscrowApiKey },
        }
      );
      const data = await res.json();

      if (res.ok && data.success && Array.isArray(data.data?.banks)) {
        // Normalize to { name, code } shape (same as NIGERIAN_BANKS)
        freshBanks = data.data.banks
          .filter((b: any) => b.code && b.name)
          .map((b: any) => ({ name: b.name, code: b.code }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name));
        fetchSuccess = true;
        console.log(`[get-banks] Fetched ${freshBanks.length} banks from Payscrow`);
      } else {
        console.error("[get-banks] Payscrow returned error:", JSON.stringify(data));
      }
    } catch (fetchErr) {
      console.error("[get-banks] Network error fetching banks:", fetchErr);
    }

    if (!fetchSuccess) {
      // Payscrow unavailable — return stale cache or fallback
      const banks = cached?.banks || FALLBACK_BANKS;
      return new Response(
        JSON.stringify({ success: true, banks, source: cached ? "stale_cache" : "fallback" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 3. Save to cache ───────────────────────────────────────────────────
    await supabaseAdmin
      .from("bank_list_cache")
      .upsert(
        { id: 1, banks: freshBanks, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );

    return new Response(
      JSON.stringify({ success: true, banks: freshBanks, source: "payscrow" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[get-banks] Unexpected error:", err);
    return new Response(
      JSON.stringify({ success: true, banks: FALLBACK_BANKS, source: "fallback" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});