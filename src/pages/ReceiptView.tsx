import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Shield, CheckCircle, Copy, AlertTriangle, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import { FeeCalculator } from "@/components/FeeCalculator";
import DisputeForm from "@/components/DisputeForm";
import DisputeTimer from "@/components/DisputeTimer";
import DisputeResponse from "@/components/DisputeResponse";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/supabase";
import { toast } from "sonner";

const formatNaira = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(amount);

const ReceiptView = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [receipt, setReceipt] = useState<any>(null);
  const [dispute, setDispute] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showDisputeForm, setShowDisputeForm] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      const { data, error } = await db
        .from("receipts")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error || !data) {
        toast.error("Receipt not found");
      } else {
        setReceipt(data);
        // Fetch associated dispute
        const { data: disputeData } = await db
          .from("disputes")
          .select("*")
          .eq("receipt_id", data.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        setDispute(disputeData);
      }
      setLoading(false);
    };
    fetch();
  }, [id]);

  const isSender = receipt?.sender_id === user?.id;
  const isReceiver = receipt?.receiver_id === user?.id;

  const handleReleaseFull = async () => {
    const { error } = await db
      .from("receipts")
      .update({ status: "completed" })
      .eq("id", receipt.id);
    if (error) toast.error("Failed to release");
    else {
      toast.success("Funds released!");
      setReceipt({ ...receipt, status: "completed" });
    }
  };

  const handleDelete = async () => {
    const { error } = await db.from("receipts").delete().eq("id", receipt.id);
    if (error) toast.error("Cannot delete");
    else {
      toast.success("Receipt deleted");
      window.history.back();
    }
  };

  const handleDisputeSubmit = async (data: any) => {
    const { error } = await db.from("disputes").insert({
      receipt_id: receipt.id,
      initiated_by: user!.id,
      reason: data.reason,
      proposed_action: data.proposedAction,
      proposed_amount: data.proposedAmount || null,
    });

    if (error) {
      toast.error("Failed to start dispute");
    } else {
      // Update receipt status
      await db.from("receipts").update({ status: "dispute" }).eq("id", receipt.id);
      toast.success("Dispute started");
      setShowDisputeForm(false);
      setReceipt({ ...receipt, status: "dispute" });
      // Refetch dispute
      const { data: d } = await db
        .from("disputes")
        .select("*")
        .eq("receipt_id", receipt.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setDispute(d);
    }
  };

  if (loading) {
    return (
      <AppLayout showBottomNav>
        <div className="pt-24 pb-16 px-4">
          <div className="container mx-auto max-w-lg animate-pulse space-y-4">
            <div className="h-6 bg-muted rounded w-1/3" />
            <div className="h-48 bg-muted rounded-2xl" />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!receipt) {
    return (
      <AppLayout showBottomNav>
        <div className="pt-24 pb-16 px-4 text-center">
          <p className="text-muted-foreground">Receipt not found</p>
          <Button variant="hero" asChild className="mt-4">
            <Link to="/dashboard">Go to Dashboard</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showBottomNav>
      <div className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-lg">
          <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            {/* Receipt card */}
            <div className="bg-card rounded-2xl shadow-card overflow-hidden">
              <div className="bg-gradient-hero p-6 text-primary-foreground">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    <span className="font-display font-semibold">Receipt</span>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-primary-foreground/20">
                    {receipt.status.charAt(0).toUpperCase() + receipt.status.slice(1)}
                  </span>
                </div>
                <p className="text-3xl font-display font-bold">{formatNaira(receipt.amount)}</p>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Description</p>
                  <p className="font-medium text-foreground">{receipt.description}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Receiver</p>
                    <p className="text-sm font-medium text-foreground">{receipt.receiver_email}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Created</p>
                    <p className="text-sm text-foreground">
                      {new Date(receipt.created_at).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>
              </div>

              <div className="px-6 pb-6">
                <FeeCalculator amount={receipt.amount} />
              </div>
            </div>

            {/* Dispute timer */}
            {dispute && (receipt.status === "dispute" || receipt.status === "unresolved") && (
              <DisputeTimer
                expiresAt={dispute.expires_at}
                autoExecuteAt={dispute.auto_execute_at}
                status={dispute.status}
              />
            )}

            {/* Dispute response (for receiver) */}
            {dispute && isReceiver && dispute.status === "open" && (
              <DisputeResponse
                proposedAction={dispute.proposed_action}
                proposedAmount={dispute.proposed_amount}
                receiptAmount={receipt.amount}
                onAccept={async () => {
                  await db.from("disputes").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", dispute.id);
                  await db.from("receipts").update({ status: "completed" }).eq("id", receipt.id);
                  toast.success("Accepted! Funds will be processed.");
                  setReceipt({ ...receipt, status: "completed" });
                }}
                onReject={async () => {
                  await db.from("disputes").update({ status: "pending_response" }).eq("id", dispute.id);
                  toast("Rejected. Dispute continues.");
                  setDispute({ ...dispute, status: "pending_response" });
                }}
              />
            )}

            {/* Dispute form */}
            <AnimatePresence>
              {showDisputeForm && (
                <DisputeForm
                  receiptAmount={receipt.amount}
                  onSubmit={handleDisputeSubmit}
                  onCancel={() => setShowDisputeForm(false)}
                />
              )}
            </AnimatePresence>

            {/* Actions for sender */}
            {isSender && receipt.status === "active" && !showDisputeForm && (
              <div className="space-y-3">
                <Button variant="hero" size="lg" className="w-full" onClick={handleReleaseFull}>
                  <CheckCircle className="w-5 h-5" /> Release Full Payment
                </Button>
                <Button variant="outline" size="lg" className="w-full" onClick={() => setShowDisputeForm(true)}>
                  <AlertTriangle className="w-5 h-5" /> Raise a Dispute
                </Button>
              </div>
            )}

            {/* Delete pending receipt */}
            {receipt.status === "pending" && receipt.created_by === user?.id && (
              <Button variant="destructive" size="lg" className="w-full" onClick={handleDelete}>
                <Trash2 className="w-5 h-5" /> Delete Receipt
              </Button>
            )}

            {/* Copy link */}
            <Button variant="secondary" className="w-full" onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              toast.success("Link copied!");
            }}>
              <Copy className="w-4 h-4" /> Copy Receipt Link
            </Button>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
};

export default ReceiptView;
