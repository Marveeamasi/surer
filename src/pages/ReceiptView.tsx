import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Shield, CheckCircle, Copy, AlertTriangle,
  Trash2, CreditCard, Edit, X, Send, Loader2, Camera,
  Upload, XCircle, Clock, Lock, Info, RefreshCw,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import { formatNaira } from "@/components/FeeCalculator";
import DisputeTimer from "@/components/DisputeTimer";
import PinVerifyDialog from "@/components/PinVerifyDialog";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/supabase";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useBankStatus } from "@/hooks/useBankStatus";

// ─────────────────────────────────────────────────────────────────────────────
// Status config — includes settling + pending_bank_details
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; bgClass: string; icon: any }> = {
  pending:              { label: "Pending Payment",          bgClass: "bg-warning/20 text-warning",         icon: Clock         },
  active:               { label: "Active — In Escrow",       bgClass: "bg-white/20",                        icon: Shield        },
  settling:             { label: "Processing Settlement",    bgClass: "bg-blue-400/20 text-blue-300",       icon: Loader2       },
  pending_bank_details: { label: "Action Required",          bgClass: "bg-orange-400/20 text-orange-300",   icon: AlertTriangle },
  dispute:              { label: "In Dispute",               bgClass: "bg-orange-400/20 text-orange-300",   icon: AlertTriangle },
  unresolved:           { label: "Unresolved — Admin Review",bgClass: "bg-destructive/20 text-destructive", icon: AlertTriangle },
  completed:            { label: "Completed",                bgClass: "bg-accent/20 text-accent",           icon: CheckCircle   },
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
const ReceiptView = () => {
  const { id }   = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [receipt,  setReceipt]  = useState<any>(null);
  const [dispute,  setDispute]  = useState<any>(null);
  const [loading,  setLoading]  = useState(true);
  const [paying,   setPaying]   = useState(false);
  const [editing,  setEditing]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [editAmount,      setEditAmount]      = useState("");
  const [editDescription, setEditDescription] = useState("");

  // Decision form
  const [showDecisionForm,   setShowDecisionForm]   = useState(false);
  const [decisionType,       setDecisionType]       = useState("");
  const [decisionReason,     setDecisionReason]     = useState("");
  const [decisionAmount,     setDecisionAmount]     = useState("");
  const [decisionEvidence,   setDecisionEvidence]   = useState<File[]>([]);
  const [decisionPreviews,   setDecisionPreviews]   = useState<string[]>([]);
  const [submittingDecision, setSubmittingDecision] = useState(false);

  const fileInputRef   = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // PIN dialog
  const [pinOpen,       setPinOpen]       = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [pinTitle,      setPinTitle]      = useState("");
  const [pinDesc,       setPinDesc]       = useState("");
  const { hasBankDetails } = useBankStatus();

  const requirePin = (title: string, desc: string, action: () => void) => {
    setPinTitle(title); setPinDesc(desc);
    setPendingAction(() => action); setPinOpen(true);
  };

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchReceipt = async () => {
    const { data, error } = await db.from("receipts").select("*").eq("id", id).maybeSingle();
    if (error || !data) { toast.error("Receipt not found"); setLoading(false); return; }
    setReceipt(data);
    const { data: disputeData } = await db
      .from("disputes").select("*").eq("receipt_id", data.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    setDispute(disputeData);
    setLoading(false);
  };

  useEffect(() => { fetchReceipt(); }, [id]); // eslint-disable-line

  // Poll while settling (check every 5s until status changes)
  useEffect(() => {
    if (receipt?.status !== "settling") return;
    const timer = setInterval(fetchReceipt, 5000);
    return () => clearInterval(timer);
  }, [receipt?.status]); // eslint-disable-line

  // ── Role detection ─────────────────────────────────────────────────────────
  const isSender   = receipt?.sender_id === user?.id;
  const isReceiver = receipt?.receiver_id === user?.id || receipt?.receiver_email === user?.email;
  const isCreator  = receipt?.created_by === user?.id;

  // ── Actions ────────────────────────────────────────────────────────────────
  const executePayNow = async () => {
    setPaying(true);
    try {
      const { data, error } = await supabase.functions.invoke("payscrow-create-payment", {
        body: { receiptId: receipt.id },
      });
      if (error || !data?.paymentLink) toast.error(data?.error || "Failed to initialize payment");
      else window.location.href = data.paymentLink;
    } catch { toast.error("Payment initialization failed — please try again"); }
    setPaying(false);
  };
  const handlePayNow = () =>
    requirePin("Confirm Payment", "Enter your PIN to proceed with payment.", executePayNow);

  const executeUpdate = async () => {
    setSaving(true);
    const { error } = await db.from("receipts")
      .update({ amount: parseFloat(editAmount), description: editDescription })
      .eq("id", receipt.id);
    setSaving(false);
    if (error) { toast.error("Failed to update"); return; }
    toast.success("Receipt updated!");
    setEditing(false);
    setReceipt({ ...receipt, amount: parseFloat(editAmount), description: editDescription });
  };
  const handleUpdate = () =>
    requirePin("Confirm Update", "Enter your PIN to save changes.", executeUpdate);

  const executeDelete = async () => {
    const { error } = await db.from("receipts").delete().eq("id", receipt.id);
    if (error) { toast.error("Cannot delete this receipt"); return; }
    toast.success("Receipt deleted"); navigate("/dashboard");
  };
  const handleDelete = () =>
    requirePin("Confirm Deletion", "Enter your PIN to permanently delete this receipt.", executeDelete);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/receipt/${receipt.id}`);
    toast.success("Link copied!");
  };

  // ── Retry settlement (for pending_bank_details) ───────────────────────────
  const executeRetrySett = async () => {
    setRetrying(true);
    const decision = receipt.settlement_decision;
    const amount   = receipt.settlement_decision_amount;

    if (!decision) {
      toast.error("No pending decision found. Please contact support.");
      setRetrying(false);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("payscrow-release", {
        body: { receiptId: receipt.id, decision, amount },
      });

      if (error || !data?.success) {
        const msg = data?.error || "Settlement failed. Please try again.";
        if (data?.requiresBankDetails) {
          toast.error(msg);
        } else {
          toast.error(msg);
        }
      } else {
        toast.success("✅ Settlement sent! Funds are being processed.");
      }
    } catch {
      toast.error("Network error. Please try again.");
    }

    await fetchReceipt();
    setRetrying(false);
  };
  const handleRetrySett = () =>
    requirePin("Retry Settlement", "Enter your PIN to retry settlement.", executeRetrySett);

  // ── Evidence helpers ───────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setDecisionEvidence(prev => [...prev, ...files]);
    setDecisionPreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))]);
  };
  const removeFile = (i: number) => {
    URL.revokeObjectURL(decisionPreviews[i]);
    setDecisionEvidence(prev => prev.filter((_, j) => j !== i));
    setDecisionPreviews(prev => prev.filter((_, j) => j !== i));
  };
  const needsForm = (type: string) => ["release_specific", "refund", "reject"].includes(type);

  // ── Start a decision ───────────────────────────────────────────────────────
  const startDecision = (type: string) => {
    setDecisionType(type); setDecisionReason(""); setDecisionAmount("");
    setDecisionEvidence([]); setDecisionPreviews([]);
    if (needsForm(type)) setShowDecisionForm(true);
    else requirePin("Confirm Decision", "Enter your PIN to confirm.", () => submitDecision(type, "", ""));
  };

  // ── Upload evidence ────────────────────────────────────────────────────────
  const uploadEvidence = async (disputeId: string) => {
    for (const file of decisionEvidence) {
      const path = `${disputeId}/${Date.now()}-${file.name}`;
      const { error } = await db.storage.from("evidence").upload(path, file, { contentType: file.type || "image/webp" });
      if (!error) await db.from("evidence").insert({ dispute_id: disputeId, file_path: path, uploaded_by: user!.id, type: "image" });
    }
  };

  const ensureDispute = async (reason: string, type: string, amt: string): Promise<string | null> => {
    if (dispute?.id) return dispute.id;
    const { data: nd } = await db.from("disputes").insert({
      receipt_id: receipt.id, initiated_by: user!.id,
      reason: reason || type, proposed_action: type,
      proposed_amount: type === "release_specific" ? parseFloat(amt) : null,
      status: "open",
      expires_at:      new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
      auto_execute_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    }).select().single();
    if (nd) { setDispute(nd); return nd.id; }
    return null;
  };

  // ── Core: submit decision (README state machine) ───────────────────────────
  const submitDecision = async (type: string, reason: string, amount: string) => {
    setSubmittingDecision(true);
    try {
      const updateData: any = {};

      if (isSender) {
        updateData.sender_decision        = type;
        updateData.sender_decision_reason = reason || null;
        updateData.sender_decision_amount = type === "release_specific" ? parseFloat(amount) : null;
      } else {
        updateData.receiver_decision        = type;
        updateData.receiver_decision_reason = reason || null;
      }

      // Clear receiver "delivered" if sender now proposes refund/partial
      if (receipt.status === "active" && isSender &&
          (type === "release_specific" || type === "refund") &&
          receipt.receiver_decision === "delivered") {
        updateData.receiver_decision        = null;
        updateData.receiver_decision_reason = null;
      }

      const newSenderDec   = isSender ? type : receipt.sender_decision;
      const newReceiverDec = (updateData.receiver_decision === null && isSender)
        ? null : isSender ? receipt.receiver_decision : type;

      let newStatus     = receipt.status;
      let shouldRelease = false;

      // ── ACTIVE transitions ───────────────────────────────────────────────
      if (receipt.status === "active") {
        if (newSenderDec === "release_all" && newReceiverDec === "delivered") {
          shouldRelease = true; newStatus = "completed";
          updateData.decision_auto_execute_at = null;
        } else if ((newSenderDec === "release_specific" || newSenderDec === "refund") && newReceiverDec === "accept") {
          shouldRelease = true; newStatus = "completed";
          updateData.decision_auto_execute_at = null;
        } else if ((newSenderDec === "release_specific" || newSenderDec === "refund") && newReceiverDec === "reject") {
          newStatus = "dispute";
          updateData.decision_auto_execute_at = null;
        } else if (!shouldRelease) {
          const onlyOneSide = (newSenderDec && !newReceiverDec) || (!newSenderDec && newReceiverDec);
          if (onlyOneSide) updateData.decision_auto_execute_at = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
        }
      }
      // ── DISPUTE transitions ──────────────────────────────────────────────
      else if (receipt.status === "dispute") {
        if (newSenderDec === "release_all") {
          shouldRelease = true; newStatus = "completed";
          updateData.decision_auto_execute_at = null;
        } else if ((newSenderDec === "release_specific" || newSenderDec === "refund") && newReceiverDec === "accept") {
          shouldRelease = true; newStatus = "completed";
          updateData.decision_auto_execute_at = null;
        }
        // (2/3 + 6): stays dispute — no status change
      }

      updateData.status = newStatus;
      await db.from("receipts").update(updateData).eq("id", receipt.id);

      // Evidence + dispute record
      if (decisionEvidence.length > 0) {
        const disputeId = await ensureDispute(reason, type, amount);
        if (disputeId) await uploadEvidence(disputeId);
      } else if (newStatus === "dispute" && receipt.status !== "dispute") {
        await ensureDispute(reason, type, amount);
      }

      // Settlement
      if (shouldRelease) {
        const releaseDecision =
          newSenderDec === "release_all" ? "release_all" :
          newSenderDec === "release_specific" ? "release_specific" : "refund";
        const releaseAmount =
          releaseDecision === "release_specific"
            ? (isSender ? parseFloat(amount) : receipt.sender_decision_amount)
            : null;

        try {
          const { data: releaseResult, error: releaseError } = await supabase.functions.invoke(
            "payscrow-release",
            { body: { receiptId: receipt.id, decision: releaseDecision, amount: releaseAmount } }
          );

          if (releaseError || !releaseResult?.success) {
            const errMsg = releaseResult?.error || "Settlement failed.";

            if (releaseResult?.requiresBankDetails) {
              // Receipt is now "pending_bank_details" — tell user what to do
              toast.error(`${errMsg} Go to Settings → Bank Details to fix this, then come back and tap Retry Settlement.`, { duration: 8000 });
            } else {
              toast.error(errMsg);
              // Revert status to pre-release state
              await db.from("receipts").update({ status: receipt.status }).eq("id", receipt.id);
            }
            setSubmittingDecision(false);
            await fetchReceipt();
            return;
          }
        } catch (e) {
          console.error("Release error:", e);
          toast.error("Network error during settlement. Please try again.");
          await db.from("receipts").update({ status: receipt.status }).eq("id", receipt.id);
          setSubmittingDecision(false);
          await fetchReceipt();
          return;
        }
      }

      // Email — fire-and-forget, never awaited, never breaks the flow
      supabase.functions.invoke("send-notification-email", {
        body: {
          type:      newStatus === "dispute" ? "dispute_started" : shouldRelease ? "dispute_resolved" : "decision_made",
          receiptId: receipt.id, decision: type,
          reason:    reason || undefined,
          decidedBy: isSender ? "sender" : "receiver",
        },
      }).catch(() => {/* email failure is silent */});

      toast.success(
        shouldRelease           ? "✅ Settlement sent. Funds will arrive in bank accounts shortly." :
        newStatus === "dispute" ? "⚠️ Dispute started. You have 4 days to reach agreement." :
                                  "Decision recorded."
      );
      setShowDecisionForm(false);
      await fetchReceipt();
    } catch (err) {
      console.error(err);
      toast.error("Failed to submit decision. Please try again.");
    }
    setSubmittingDecision(false);
  };

  const handleDecisionFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    requirePin("Confirm Decision", "Enter your PIN to submit.", () =>
      submitDecision(decisionType, decisionReason, decisionAmount)
    );
  };

  // ── getSenderActions ───────────────────────────────────────────────────────
  const getSenderActions = () => {
    if (!isSender) return null;
    if (["unresolved", "completed", "pending", "settling", "pending_bank_details"].includes(receipt.status)) return null;
    if (receipt.status === "active" && receipt.sender_decision) return null;

    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-foreground">
          {receipt.status === "dispute" ? "Update your decision:" : "What would you like to do?"}
        </p>
        <Button variant="hero" size="lg" className="w-full" onClick={() => startDecision("release_all")}>
          <CheckCircle className="w-5 h-5" /> Release Full Payment to Receiver
        </Button>
        <Button variant="outline" size="lg" className="w-full" onClick={() => startDecision("release_specific")}>
          <Send className="w-5 h-5" /> Release a Specific Amount
        </Button>
        <Button variant="destructive" size="lg" className="w-full" onClick={() => startDecision("refund")}>
          <XCircle className="w-5 h-5" /> Request Full Refund
        </Button>
        <p className="text-xs text-center text-muted-foreground">
          No response from the receiver in 2 days = your decision executes automatically.
        </p>
      </div>
    );
  };

  // ── getReceiverActions ─────────────────────────────────────────────────────
  const getReceiverActions = () => {
    if (!isReceiver) return null;
    if (["unresolved", "completed", "pending", "settling", "pending_bank_details"].includes(receipt.status)) return null;

    const senderProposed = receipt.sender_decision === "release_specific" || receipt.sender_decision === "refund";

    // DISPUTE: always show Accept/Reject
    if (receipt.status === "dispute") {
      return (
        <div className="space-y-3">
          {receipt.sender_decision && <SenderProposalBanner receipt={receipt} />}
          <p className="text-sm font-semibold text-foreground">Your response:</p>
          <Button variant="hero"        size="lg" className="w-full" onClick={() => startDecision("accept")}>
            <CheckCircle className="w-5 h-5" /> Accept Proposal
          </Button>
          <Button variant="destructive" size="lg" className="w-full" onClick={() => startDecision("reject")}>
            <XCircle className="w-5 h-5" /> Reject Proposal
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Rejecting keeps the dispute open. The 4-day window continues.
          </p>
        </div>
      );
    }

    // ACTIVE: sender proposed refund/partial → show Accept/Reject regardless of DB receiver_decision
    if (senderProposed) {
      return (
        <div className="space-y-3">
          <SenderProposalBanner receipt={receipt} />
          <p className="text-sm font-semibold text-foreground">Your response:</p>
          <Button variant="hero"        size="lg" className="w-full" onClick={() => startDecision("accept")}>
            <CheckCircle className="w-5 h-5" /> Accept
          </Button>
          <Button variant="destructive" size="lg" className="w-full" onClick={() => startDecision("reject")}>
            <XCircle className="w-5 h-5" /> Reject (starts dispute)
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            No response in 2 days = auto-executed per sender's terms.
          </p>
        </div>
      );
    }

    // Receiver made a final decision (accept/reject) — waiting for outcome
    if (receipt.receiver_decision === "accept" || receipt.receiver_decision === "reject") return null;

    // Receiver already marked as delivered — show confirmation, waiting for sender
    if (receipt.receiver_decision === "delivered") {
      return (
        <div className="bg-accent/10 border border-accent/20 rounded-xl p-4 flex gap-3">
          <CheckCircle className="w-5 h-5 text-accent shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-foreground">You marked this as delivered</p>
            <p className="text-xs text-muted-foreground mt-1">
              Waiting for the sender to release funds. If they don't respond in 2 days,
              the payment will be automatically released to you.
            </p>
          </div>
        </div>
      );
    }

    // Default: no decision yet
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-foreground">Your decision:</p>
        <Button variant="hero" size="lg" className="w-full" onClick={() => startDecision("delivered")}>
          <CheckCircle className="w-5 h-5" /> I Have Delivered
        </Button>
        <p className="text-xs text-center text-muted-foreground">
          Tap once you've delivered. The sender will confirm and release funds.
        </p>
      </div>
    );
  };

  // ── Decision display (read-only history) ──────────────────────────────────
  const getDecisionDisplay = () => {
    if (!receipt.sender_decision && !receipt.receiver_decision) return null;
    const labels: Record<string, string> = {
      release_all:      "Release Full Payment",
      release_specific: `Release ${formatNaira(receipt.sender_decision_amount || 0)}`,
      refund:           "Full Refund",
      delivered:        "Delivered",
      accept:           "Accepted",
      reject:           "Rejected",
    };
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Decisions Recorded</p>
        {receipt.sender_decision && (
          <div className="bg-secondary rounded-xl p-4 border border-border">
            <span className="text-xs font-semibold text-primary uppercase tracking-wide">Sender's Decision</span>
            <p className="font-semibold text-foreground mt-1">{labels[receipt.sender_decision] || receipt.sender_decision}</p>
            {receipt.sender_decision_reason && (
              <p className="text-xs text-muted-foreground mt-1 italic">"{receipt.sender_decision_reason}"</p>
            )}
          </div>
        )}
        {receipt.receiver_decision && (
          <div className="bg-secondary rounded-xl p-4 border border-border">
            <span className="text-xs font-semibold text-accent uppercase tracking-wide">Receiver's Decision</span>
            <p className="font-semibold text-foreground mt-1">{labels[receipt.receiver_decision] || receipt.receiver_decision}</p>
            {receipt.receiver_decision_reason && (
              <p className="text-xs text-muted-foreground mt-1 italic">"{receipt.receiver_decision_reason}"</p>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Loading / not-found ────────────────────────────────────────────────────
  if (loading) {
    return (
      <AppLayout showBottomNav>
        <div className="pt-24 pb-16 px-4">
          <div className="container mx-auto max-w-lg animate-pulse space-y-4">
            <div className="h-6 bg-muted rounded w-1/3" />
            <div className="h-52 bg-muted rounded-2xl" />
            <div className="h-12 bg-muted rounded-xl" />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!receipt) {
    return (
      <AppLayout showBottomNav>
        <div className="pt-24 pb-16 px-4 text-center space-y-4">
          <p className="text-muted-foreground">Receipt not found.</p>
          <Button variant="hero" asChild><Link to="/dashboard">Go to Dashboard</Link></Button>
        </div>
      </AppLayout>
    );
  }

  const statusCfg     = STATUS_CONFIG[receipt.status] || STATUS_CONFIG.pending;
  const StatusIcon    = statusCfg.icon;
  const protectionFee = Number(receipt.protection_fee || 0);
  const isSettling    = receipt.status === "settling";
  const needsBank     = receipt.status === "pending_bank_details";

  return (
    <AppLayout showBottomNav>
      <div className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-lg">
          <Link to="/dashboard"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

            {/* ── Receipt card ──────────────────────────────────────────── */}
            <div className="bg-card rounded-2xl shadow-card overflow-hidden border border-border">
              <div className="bg-gradient-hero p-6 text-primary-foreground">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    <span className="font-display font-semibold text-sm">Surer Receipt</span>
                  </div>
                  <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${statusCfg.bgClass}`}>
                    {isSettling
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <StatusIcon className="w-3 h-3" />}
                    {statusCfg.label}
                  </div>
                </div>
                <p className="text-4xl font-display font-bold tracking-tight">{formatNaira(receipt.amount)}</p>
                {receipt.status === "pending" && isSender && protectionFee > 0 && (
                  <p className="text-sm mt-1.5 opacity-80">
                    + {formatNaira(protectionFee)} protection fee = <strong>{formatNaira(receipt.amount + protectionFee)}</strong> total
                  </p>
                )}
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Description</p>
                  <p className="font-semibold text-foreground">{receipt.description}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Receiver</p>
                    <p className="text-sm font-medium text-foreground break-all">{receipt.receiver_email}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Created</p>
                    <p className="text-sm text-foreground">
                      {new Date(receipt.created_at).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>

                {/* Pending: fee breakdown for sender */}
                {receipt.status === "pending" && isSender && protectionFee > 0 && (
                  <div className="rounded-xl bg-secondary p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Amount to receiver</span>
                      <span className="font-semibold">{formatNaira(receipt.amount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Protection Fee</span>
                      <span className="font-semibold">{formatNaira(protectionFee)}</span>
                    </div>
                    <div className="border-t border-border pt-2 flex justify-between font-display">
                      <span className="font-bold">Total you pay</span>
                      <span className="font-bold text-primary">{formatNaira(receipt.amount + protectionFee)}</span>
                    </div>
                  </div>
                )}

                {/* Active: escrow notice */}
                {receipt.status === "active" && (
                  <div className="flex items-start gap-2.5 bg-primary/5 rounded-xl p-3">
                    <Lock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <strong className="text-foreground">{formatNaira(receipt.amount)}</strong> is
                      held safely in Payscrow escrow until both parties agree.
                    </p>
                  </div>
                )}

                {/* Settling: processing notice */}
                {isSettling && (
                  <div className="flex items-start gap-2.5 bg-blue-500/5 rounded-xl p-3">
                    <Loader2 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5 animate-spin" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Settlement is being processed. Funds will arrive in bank accounts shortly.
                      This page will update automatically.
                    </p>
                  </div>
                )}

                {/* Completed: success notice */}
              {receipt.status === "completed" && (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 bg-accent/10 rounded-xl p-3">
        <CheckCircle className="w-4 h-4 text-accent shrink-0" />
        <p className="text-xs text-muted-foreground">
          Settlement complete.
          {receipt.paid_at &&
            ` Processed on ${new Date(receipt.paid_at).toLocaleDateString("en-NG", {
              month: "short", day: "numeric", year: "numeric",
            })}.`}
        </p>
      </div>

      {// Show this notice ONLY to the receiver if they have no bank details set
       // Funds may be awaiting them but can't be sent without an account
       isReceiver && !hasBankDetails && (
        <div className="bg-warning/10 border border-warning/20 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground">Add your bank details</p>
              <p className="text-xs text-muted-foreground mt-1">
                This receipt is complete. If funds are owed to you, they cannot be sent
                without your bank account details. Add them in Settings, then contact support
                or the admin will process your settlement shortly.
              </p>
            </div>
          </div>
          <Button variant="hero" size="sm" className="w-full" asChild>
            <Link to="/settings">Go to Settings → Add Bank Details</Link>
          </Button>
        </div>
      )}
    </div>
  )}
              </div>
            </div>

            {/* ── pending_bank_details: actionable prompt ───────────────── */}
            {needsBank && (
              <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 space-y-3">
                <div className="flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-sm text-foreground">Bank Details Required</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {receipt.pending_bank_party === "receiver"
                        ? "The receiver needs to add their bank account in Settings before funds can be sent."
                        : receipt.pending_bank_party === "sender"
                        ? "The sender needs to add their bank account in Settings before the refund can be processed."
                        : "Both parties need to add their bank account details in Settings."}
                    </p>
                  </div>
                </div>
                {/* Show retry button to the relevant party */}
                {((receipt.pending_bank_party === "receiver" && isReceiver) ||
                  (receipt.pending_bank_party === "sender"   && isSender)   ||
                  (receipt.pending_bank_party === "both")) && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" asChild>
                      <Link to="/settings">Go to Settings</Link>
                    </Button>
                    <Button variant="hero" size="sm" className="flex-1"
                      onClick={handleRetrySett} disabled={retrying}>
                      {retrying
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Retrying...</>
                        : <><RefreshCw className="w-4 h-4" /> Retry Settlement</>}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* ── Decisions recorded ────────────────────────────────────── */}
            {getDecisionDisplay()}

            {/* ── Auto-execute timer ───────────────────────────────────── */}
            {receipt.decision_auto_execute_at && receipt.status === "active" && (
              <DisputeTimer
                expiresAt={receipt.decision_auto_execute_at}
                autoExecuteAt={receipt.decision_auto_execute_at}
                status="active"
              />
            )}

            {/* ── Dispute timer ─────────────────────────────────────────── */}
            {dispute && (receipt.status === "dispute" || receipt.status === "unresolved") && (
              <DisputeTimer
                expiresAt={dispute.expires_at}
                autoExecuteAt={dispute.auto_execute_at || dispute.expires_at}
                status={dispute.status}
              />
            )}

            {/* ── Unresolved notice ─────────────────────────────────────── */}
            {receipt.status === "unresolved" && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm text-foreground">Awaiting Admin Decision</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    The 4-day dispute window expired. An admin is reviewing the evidence
                    and will make a final settlement decision shortly.
                  </p>
                </div>
              </div>
            )}

            {/* ── Pay Now ──────────────────────────────────────────────── */}
            {isSender && receipt.status === "pending" && (
              <Button variant="hero" size="lg" className="w-full" onClick={handlePayNow} disabled={paying}>
                {paying
                  ? <><Loader2 className="w-5 h-5 animate-spin" /> Initializing...</>
                  : <><CreditCard className="w-5 h-5" />
                      Pay {protectionFee > 0 ? formatNaira(receipt.amount + protectionFee) : formatNaira(receipt.amount)} Now
                    </>}
              </Button>
            )}

            {/* ── Decision buttons ─────────────────────────────────────── */}
            {getSenderActions()}
            {getReceiverActions()}

            {/* ── Decision form ─────────────────────────────────────────── */}
            <AnimatePresence>
              {showDecisionForm && (
                <motion.form
                  initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
                  onSubmit={handleDecisionFormSubmit}
                  className="space-y-4 bg-card rounded-2xl shadow-card p-6 border border-border"
                >
                  <h3 className="font-display font-semibold text-foreground">
                    {decisionType === "release_specific" ? "Release a Specific Amount" :
                     decisionType === "refund"           ? "Request Full Refund" : "Reject Proposal"}
                  </h3>

                  {decisionType === "release_specific" && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Amount to release (₦)</label>
                      <Input type="number" min={1} max={receipt.amount}
                        placeholder={`Up to ${formatNaira(receipt.amount)}`}
                        value={decisionAmount} onChange={e => setDecisionAmount(e.target.value)}
                        required className="h-12 text-lg font-semibold" />
                      {decisionAmount && parseFloat(decisionAmount) < receipt.amount && (
                        <p className="text-xs text-muted-foreground">
                          Receiver gets {formatNaira(parseFloat(decisionAmount))},
                          you get {formatNaira(receipt.amount - parseFloat(decisionAmount))} back.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      {decisionType === "reject" ? "Why are you rejecting?" : "Reason"}
                    </label>
                    <Textarea placeholder="Explain clearly so the other party understands..."
                      value={decisionReason} onChange={e => setDecisionReason(e.target.value)} required rows={3} />
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-medium text-foreground">
                      Evidence <span className="text-muted-foreground font-normal">(optional but recommended)</span>
                    </label>
                    <div className="flex gap-3">
                      <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="flex-1">
                        <Upload className="w-4 h-4" /> Upload Photo
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => cameraInputRef.current?.click()} className="flex-1">
                        <Camera className="w-4 h-4" /> Take Photo
                      </Button>
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
                    <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />
                    {decisionPreviews.length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        {decisionPreviews.map((url, i) => (
                          <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                            <img src={url} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                            <button type="button" onClick={() => removeFile(i)}
                              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-destructive flex items-center justify-center">
                              <X className="w-3 h-3 text-destructive-foreground" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-1">
                    <Button type="button" variant="outline" size="lg" className="flex-1"
                      onClick={() => setShowDecisionForm(false)}>Cancel</Button>
                    <Button type="submit" size="lg" className="flex-1"
                      variant={decisionType === "reject" ? "destructive" : "hero"}
                      disabled={submittingDecision}>
                      {submittingDecision ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</> :
                       decisionType === "reject" ? "Reject" : "Submit"}
                    </Button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>

            {/* ── Edit pending receipt ──────────────────────────────────── */}
            {receipt.status === "pending" && isCreator && !editing && (
              <Button variant="outline" size="lg" className="w-full"
                onClick={() => { setEditAmount(receipt.amount.toString()); setEditDescription(receipt.description); setEditing(true); }}>
                <Edit className="w-5 h-5" /> Edit Receipt
              </Button>
            )}
            {editing && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="space-y-3 bg-card rounded-2xl p-6 shadow-card border border-border">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Amount (₦)</label>
                  <Input type="number" min={1000} value={editAmount} onChange={e => setEditAmount(e.target.value)} className="h-12" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Description</label>
                  <Textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={3} />
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button variant="hero" className="flex-1" onClick={handleUpdate} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Changes"}
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ── Delete ───────────────────────────────────────────────── */}
            {receipt.status === "pending" && isCreator && (
              <Button variant="destructive" size="lg" className="w-full" onClick={handleDelete}>
                <Trash2 className="w-5 h-5" /> Delete Receipt
              </Button>
            )}

            {/* ── Copy link ─────────────────────────────────────────────── */}
            <Button variant="secondary" className="w-full" onClick={handleCopyLink}>
              <Copy className="w-4 h-4" /> Copy Receipt Link
            </Button>

          </motion.div>
        </div>
      </div>

      <PinVerifyDialog
        open={pinOpen} onOpenChange={setPinOpen}
        onVerified={() => { if (pendingAction) pendingAction(); setPendingAction(null); }}
        title={pinTitle} description={pinDesc}
      />
    </AppLayout>
  );
};

// ── Sub-component: Sender's proposal banner ────────────────────────────────
const SenderProposalBanner = ({ receipt }: { receipt: any }) => (
  <div className="bg-warning/10 border border-warning/20 rounded-xl p-4">
    <div className="flex items-center gap-2 mb-2">
      <Info className="w-4 h-4 text-warning shrink-0" />
      <p className="text-sm font-semibold text-foreground">Sender's Proposal</p>
    </div>
    <p className="text-sm text-muted-foreground">
      {receipt.sender_decision === "refund"
        ? "The sender is requesting a full refund of this payment."
        : receipt.sender_decision === "release_specific"
          ? `The sender wants to release ${formatNaira(receipt.sender_decision_amount || 0)} of ${formatNaira(receipt.amount)}.`
          : "The sender wants to release the full payment to you."}
    </p>
    {receipt.sender_decision_reason && (
      <p className="text-xs text-muted-foreground mt-2 italic border-t border-warning/20 pt-2">
        "{receipt.sender_decision_reason}"
      </p>
    )}
  </div>
);

export default ReceiptView;