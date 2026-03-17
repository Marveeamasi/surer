import { useMemo, useEffect, useState } from "react";
import { db } from "@/lib/supabase";

export interface FeeSettings {
  fee_percentage: number; // e.g. 3.5
  base_fee: number;       // e.g. 100
  fee_cap: number;        // e.g. 2000
}

export const DEFAULT_FEE_SETTINGS: FeeSettings = {
  fee_percentage: 3.5,
  base_fee: 100,
  fee_cap: 2000,
};


export const calculateFee = (
  amount: number,
  settings: FeeSettings = DEFAULT_FEE_SETTINGS
): number => {
  if (amount <= 0) return 0;
  const raw = (amount * settings.fee_percentage) / 100 + settings.base_fee;
  return Math.min(raw, settings.fee_cap);
};

export const useFeeSettings = () => {
  const [settings, setSettings] = useState<FeeSettings>(DEFAULT_FEE_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data, error } = await db
        .from("fee_settings")
        .select("fee_percentage, base_fee, fee_cap")
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        setSettings({
          fee_percentage: Number(data.fee_percentage),
          base_fee: Number(data.base_fee),
          fee_cap: Number(data.fee_cap),
        });
      }
      setLoading(false);
    };
    fetch();
  }, []);

  return { settings, loading };
};

export const formatNaira = (amount: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(amount);

interface FeeCalculatorProps {
  amount: number;
  feeSettings?: FeeSettings;
}

const FeeCalculator = ({ amount, feeSettings }: FeeCalculatorProps) => {
  const { settings: fetchedSettings, loading } = useFeeSettings();
  const settings = feeSettings || fetchedSettings;

  const protectionFee = useMemo(
    () => calculateFee(amount, settings),
    [amount, settings]
  );

  if (amount <= 0) return null;
  if (loading && !feeSettings) return null;

  return (
    <div className="rounded-xl bg-secondary p-4 space-y-2 text-sm">
      {/* Single unified protection fee — no confusing split */}
      <div className="flex justify-between">
        <span className="text-muted-foreground">Protection Fee</span>
        <span className="font-semibold text-foreground">
          {formatNaira(protectionFee)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {settings.fee_percentage}% of amount + {formatNaira(settings.base_fee)} (max{" "}
        {formatNaira(settings.fee_cap)})
      </p>
      <div className="border-t border-border pt-2 flex justify-between font-display">
        <span className="font-bold text-foreground">You pay</span>
        <span className="font-bold text-primary">
          {formatNaira(amount + protectionFee)}
        </span>
      </div>
    </div>
  );
};

export { FeeCalculator };
export default FeeCalculator;