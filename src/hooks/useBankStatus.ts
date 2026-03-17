import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/supabase";

export const useBankStatus = () => {
  const { user } = useAuth();
  const [hasBankDetails, setHasBankDetails] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      if (!user) { setLoading(false); return; }
      const { data } = await db
        .from("profiles")
        .select("bank_code, account_number, account_name")
        .eq("id", user.id)
        .maybeSingle();
      setHasBankDetails(
        !!(data?.bank_code && data?.account_number && data?.account_name)
      );
      setLoading(false);
    };
    check();
  }, [user]);

  return { hasBankDetails, loading };
};