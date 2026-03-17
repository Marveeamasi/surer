/**
 * usePhoneNumber.ts
 *
 * Single export: usePhoneNumber()
 *
 * PURPOSE:
 *   Payscrow requires a phone number for both customerPhoneNo and merchantPhoneNo
 *   when creating a transaction. We need a real or sensible value server-side.
 *
 * STRATEGY:
 *   1. If the user has saved a phone number on their profile → use that (real)
 *   2. If not → generate a silent deterministic fallback from their user ID
 *      This fallback is NEVER shown to the user and is only used by the edge function.
 *      It keeps Payscrow happy without forcing the user to add a number before paying.
 *   3. Once the user saves bank details (which requires a phone number), their real
 *      number is stored and used from that point forward.
 *
 * NOTE: This hook is purely for the edge function's benefit.
 *   Users interact with phone number ONLY in the bank details section of Settings.
 *   It is not surfaced anywhere else in the UI.
 */

import { useState, useEffect } from "react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

/** Nigerian phone number regex: 070/080/081/090/091 + 8 digits */
export const NIGERIAN_PHONE_REGEX = /^(070|080|081|090|091)\d{8}$/;

/** Validate a Nigerian phone number */
export const isValidNigerianPhone = (phone: string): boolean =>
  NIGERIAN_PHONE_REGEX.test(phone.replace(/\s/g, ""));

/**
 * Generate a silent fallback phone number from a user ID.
 * Format: 080 + first 8 hex chars of UUID converted to digits (0-9 only).
 * This is deterministic — same user always gets the same fallback.
 * It's a valid-looking Nigerian number format but is never used for real contact.
 */
const generateFallbackPhone = (userId: string): string => {
  // Take first 8 chars of UUID (after removing dashes), map each hex char to a digit 0-9
  const hex = userId.replace(/-/g, "").slice(0, 8);
  const digits = hex.split("").map((c) => {
    const n = parseInt(c, 16); // 0-15
    return (n % 10).toString(); // map to 0-9
  }).join("");
  return `080${digits}`; // "080" prefix + 8 digits = valid-looking NGN number
};

export interface UsePhoneNumberResult {
  /** The phone number to pass to Payscrow (real if set, fallback if not) */
  phoneForPayscrow: string;
  /** Whether the user has set a real phone number on their profile */
  hasRealPhone: boolean;
  loading: boolean;
}

export const usePhoneNumber = (): UsePhoneNumberResult => {
  const { user } = useAuth();
  const [phoneForPayscrow, setPhoneForPayscrow] = useState("");
  const [hasRealPhone,     setHasRealPhone]     = useState(false);
  const [loading,          setLoading]          = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }

    const fetch = async () => {
      const { data } = await db
        .from("profiles")
        .select("phone_number")
        .eq("id", user.id)
        .maybeSingle();

      const saved = data?.phone_number?.replace(/\s/g, "") || "";
      if (saved && isValidNigerianPhone(saved)) {
        setPhoneForPayscrow(saved);
        setHasRealPhone(true);
      } else {
        // User hasn't set a phone yet — use silent fallback
        setPhoneForPayscrow(generateFallbackPhone(user.id));
        setHasRealPhone(false);
      }
      setLoading(false);
    };

    fetch();
  }, [user]);

  return { phoneForPayscrow, hasRealPhone, loading };
};