import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Clock } from "lucide-react";
import { motion } from "framer-motion";

interface DisputeResponseProps {
  proposedAction: string;
  proposedAmount?: number;
  receiptAmount: number;
  onAccept: () => void;
  onReject: () => void;
}

const formatNaira = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(amount);

const DisputeResponse = ({ proposedAction, proposedAmount, receiptAmount, onAccept, onReject }: DisputeResponseProps) => {
  const getSpamFee = () => {
    if (receiptAmount < 50000) return 100;
    if (receiptAmount < 500000) return 200;
    return 300;
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-card rounded-2xl shadow-card p-6 space-y-4 border border-border"
    >
      <div className="text-center space-y-2">
        <div className="w-12 h-12 mx-auto rounded-full bg-warning/10 flex items-center justify-center">
          <Clock className="w-6 h-6 text-warning" />
        </div>
        <h3 className="font-display text-lg font-bold text-foreground">Action Required</h3>
        <p className="text-sm text-muted-foreground">
          {proposedAction === "refund_full"
            ? "The sender is requesting a full refund."
            : `The sender wants to release only ${formatNaira(proposedAmount || 0)} of ${formatNaira(receiptAmount)}.`}
        </p>
      </div>

      <div className="bg-secondary rounded-xl p-4 text-center">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Proposed</p>
        <p className="font-display text-xl font-bold text-foreground">
          {proposedAction === "refund_full" ? "Full Refund" : `Release ${formatNaira(proposedAmount || 0)}`}
        </p>
      </div>

      <div className="space-y-3">
        <Button variant="hero" size="lg" className="w-full" onClick={onAccept}>
          <CheckCircle className="w-5 h-5" /> Accept
        </Button>
        <Button variant="destructive" size="lg" className="w-full" onClick={onReject}>
          <XCircle className="w-5 h-5" /> Reject (₦{getSpamFee().toLocaleString()} fee)
        </Button>
        <p className="text-xs text-center text-muted-foreground">
          If you don't respond within 2 days, this will be executed automatically.
        </p>
      </div>
    </motion.div>
  );
};

export default DisputeResponse;
