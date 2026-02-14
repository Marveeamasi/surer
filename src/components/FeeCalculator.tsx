import { useMemo } from "react";

const formatNaira = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(amount);

const calculateFees = (amount: number) => {
  const surerFee = Math.min(amount * 0.015, 700);
  const payscrowFee = Math.min(amount * 0.02 + 100, 1000);
  return { surerFee, payscrowFee, total: surerFee + payscrowFee };
};

const FeeCalculator = ({ amount }: { amount: number }) => {
  const fees = useMemo(() => calculateFees(amount), [amount]);

  if (amount <= 0) return null;

  return (
    <div className="rounded-xl bg-secondary p-4 space-y-2 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Protection Fee (Surer)</span>
        <span className="font-semibold text-foreground">{formatNaira(fees.surerFee)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Processing Fee (Payscrow)</span>
        <span className="font-semibold text-foreground">{formatNaira(fees.payscrowFee)}</span>
      </div>
      <div className="border-t border-border pt-2 flex justify-between font-display">
        <span className="font-bold text-foreground">Total Fees</span>
        <span className="font-bold text-primary">{formatNaira(fees.total)}</span>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>You pay</span>
        <span className="font-semibold">{formatNaira(amount + fees.total)}</span>
      </div>
    </div>
  );
};

export { FeeCalculator, calculateFees, formatNaira };
