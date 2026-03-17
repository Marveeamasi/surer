import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { NIGERIAN_BANKS } from "@/lib/nigerian-banks";

export interface Bank {
  name: string;
  code: string;
}

// Emergency fallback — only if edge function AND sessionStorage both fail
const EMERGENCY_FALLBACK: Bank[] = NIGERIAN_BANKS;

const SESSION_KEY = "surer_banks_cache";

export const useBanks = () => {
  const [banks,   setBanks]   = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      // 1. Try sessionStorage (instant, no network)
      try {
        const cached = sessionStorage.getItem(SESSION_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as Bank[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            setBanks(parsed);
            setLoading(false);
            return;
          }
        }
      } catch { /* parse error — fall through */ }

      // 2. Call edge function
      try {
        const { data, error } = await supabase.functions.invoke("payscrow-get-banks");
        if (!error && data?.success && Array.isArray(data.banks) && data.banks.length > 0) {
          setBanks(data.banks as Bank[]);
          try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data.banks)); } catch { /* storage full */ }
          setLoading(false);
          return;
        }
      } catch (e) {
        console.error("[useBanks] Edge function failed:", e);
      }

      // 3. Emergency fallback
      setBanks(EMERGENCY_FALLBACK);
      setLoading(false);
    };

    load();
  }, []);

  const getBankName = (code: string): string =>
    banks.find((b) => b.code === code)?.name || code;

  return { banks, loading, getBankName };
};