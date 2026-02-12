import { Button } from "@/components/ui/button";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Shield, Clock, CheckCircle, AlertTriangle, Copy } from "lucide-react";
import { motion } from "framer-motion";
import Navbar from "@/components/Navbar";
import { FeeCalculator } from "@/components/FeeCalculator";

const formatNaira = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(amount);

// Mock receipt
const mockReceipt = {
  id: "1",
  description: "Logo design for startup",
  amount: 50000,
  status: "active" as const,
  sender: "john@example.com",
  receiver: "designer@email.com",
  createdAt: "Feb 10, 2026",
  currentUserRole: "sender" as const,
};

const statusColors = {
  pending: "bg-warning/10 text-warning",
  active: "bg-primary/10 text-primary",
  dispute: "bg-destructive/10 text-destructive",
  completed: "bg-accent/10 text-accent",
};

const ReceiptView = () => {
  const { id } = useParams();
  const receipt = mockReceipt;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-lg">
          <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            {/* Receipt card */}
            <div className="bg-card rounded-2xl shadow-card overflow-hidden">
              {/* Header bar */}
              <div className="bg-gradient-hero p-6 text-primary-foreground">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    <span className="font-display font-semibold">Receipt #{id}</span>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium bg-primary-foreground/20`}>
                    {receipt.status.charAt(0).toUpperCase() + receipt.status.slice(1)}
                  </span>
                </div>
                <p className="text-3xl font-display font-bold">{formatNaira(receipt.amount)}</p>
              </div>

              {/* Details */}
              <div className="p-6 space-y-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Description</p>
                  <p className="font-medium text-foreground">{receipt.description}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Sender</p>
                    <p className="text-sm font-medium text-foreground">{receipt.sender}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Receiver</p>
                    <p className="text-sm font-medium text-foreground">{receipt.receiver}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Created</p>
                  <p className="text-sm text-foreground">{receipt.createdAt}</p>
                </div>
              </div>

              {/* Fee breakdown */}
              <div className="px-6 pb-6">
                <FeeCalculator amount={receipt.amount} />
              </div>
            </div>

            {/* Actions for sender */}
            {receipt.currentUserRole === "sender" && receipt.status === "active" && (
              <div className="space-y-3">
                <Button variant="hero" size="lg" className="w-full">
                  <CheckCircle className="w-5 h-5" /> Release Full Payment
                </Button>
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="outline" size="lg">
                    Release Specific Amount
                  </Button>
                  <Button variant="destructive" size="lg">
                    Request Refund
                  </Button>
                </div>
              </div>
            )}

            {/* Copy link */}
            <Button variant="secondary" className="w-full" onClick={() => navigator.clipboard.writeText(window.location.href)}>
              <Copy className="w-4 h-4" /> Copy Receipt Link
            </Button>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default ReceiptView;
