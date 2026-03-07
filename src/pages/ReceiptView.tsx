import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Shield, CheckCircle, Copy, AlertTriangle, Trash2, CreditCard,
  Edit, X, Send, Loader2, Camera, Upload, XCircle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import { FeeCalculator, formatNaira } from "@/components/FeeCalculator";
import DisputeTimer from "@/components/DisputeTimer";
import PinVerifyDialog from "@/components/PinVerifyDialog";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/supabase";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ReceiptView = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<any>(null);
  const [dispute, setDispute] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editAmount, setEditAmount] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Decision form state
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [decisionType, setDecisionType] = useState<string>("");
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionAmount, setDecisionAmount] = useState("");
  const [decisionEvidence, setDecisionEvidence] = useState<File[]>([]);
  const [decisionPreviews, setDecisionPreviews] = useState<string[]>([]);
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // PIN verification
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [pinTitle, setPinTitle] = useState("");
  const [pinDesc, setPinDesc] = useState("");

  const requirePin = (title: string, desc: string, action: () => void) => {
    setPinTitle(title);
    setPinDesc(desc);
    setPendingAction(() => action);
    setPinOpen(true);
  };

  const fetchReceipt = async () => {
    const { data, error } = await db
      .from("receipts")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      toast.error("Receipt not found");
    } else {
      setReceipt(data);
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchReceipt();
  }, [id]);

  // Resume pending decision after Paystack spam fee callback
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const handleRedirect = async () => {
      const ref = searchParams.get("reference") || searchParams.get("trxref");
      if (ref && receipt) {
        const pendingStr = sessionStorage.getItem("pending_decision");
        if (pendingStr) {
          const pending = JSON.parse(pendingStr);
          if (pending.receiptId === receipt.id) {
            // verify spam fee server‑side before finalizing the action
            try {
              const { data, error } = await supabase.functions.invoke("paystack-verify-spam-fee", {
                body: { reference: ref, receiptId: receipt.id },
              });

              if (error || !data?.success) {
                // If verification fails we'll still allow the user to retry
                toast.error("Unable to verify fee payment. Please try again.");
                return;
              }

              sessionStorage.removeItem("pending_decision");
              toast.success("Fee paid! Submitting your decision...");
              submitDecision(pending.type, pending.reason, pending.amount);
              window.history.replaceState({}, "", `/receipt/${id}`);
            } catch (e) {
              console.error("Spam fee verify error", e);
              toast.error("Error verifying fee payment");
            }
          }
        } else {
          // no pending decision but might have just paid the fee via redirect
          // refresh receipt state in case webhook/verify updated it
          await fetchReceipt();
          window.history.replaceState({}, "", `/receipt/${id}`);
        }
      }
    };

    handleRedirect();
  }, [searchParams, receipt]);

  const isSender = receipt?.sender_id === user?.id;
  const isReceiver = receipt?.receiver_id === user?.id || receipt?.receiver_email === user?.email;
  const isCreator = receipt?.created_by === user?.id;

  // Pay Now
  const executePayNow = async () => {
    setPaying(true);
    try {
      const { data, error } = await supabase.functions.invoke("payscrow-create-payment", {
        body: { receiptId: receipt.id },
      });
      if (error || !data?.paymentLink) {
        toast.error(data?.error || "Failed to initialize payment");
      } else {
        window.location.href = data.paymentLink;
      }
    } catch {
      toast.error("Payment initialization failed");
    }
    setPaying(false);
  };

  const handlePayNow = () => {
    requirePin("Confirm Payment", "Enter your PIN to proceed with payment.", executePayNow);
  };

  // Update receipt
  const executeUpdate = async () => {
    setSaving(true);
    const { error } = await db
      .from("receipts")
      .update({ amount: parseFloat(editAmount), description: editDescription })
      .eq("id", receipt.id);
    setSaving(false);
    if (error) toast.error("Failed to update");
    else {
      toast.success("Receipt updated!");
      setEditing(false);
      setReceipt({ ...receipt, amount: parseFloat(editAmount), description: editDescription });
    }
  };

  const handleUpdate = () => {
    requirePin("Confirm Update", "Enter your PIN to update this receipt.", executeUpdate);
  };

  // Delete receipt
  const executeDelete = async () => {
    const { error } = await db.from("receipts").delete().eq("id", receipt.id);
    if (error) toast.error("Cannot delete");
    else { toast.success("Receipt deleted"); navigate("/dashboard"); }
  };

  const handleDelete = () => {
    requirePin("Confirm Deletion", "Enter your PIN to permanently delete this receipt.", executeDelete);
  };

  // Copy link
  const handleCopyLink = () => {
    const cleanUrl = `${window.location.origin}/receipt/${receipt.id}`;
    navigator.clipboard.writeText(cleanUrl);
    toast.success("Link copied!");
  };

  // File handling
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setDecisionEvidence((prev) => [...prev, ...files]);
    const newPreviews = files.map((f) => URL.createObjectURL(f));
    setDecisionPreviews((prev) => [...prev, ...newPreviews]);
  };

  const removeFile = (index: number) => {
    setDecisionEvidence((prev) => prev.filter((_, i) => i !== index));
    URL.revokeObjectURL(decisionPreviews[index]);
    setDecisionPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const getSpamFee = () => {
    if (!receipt) return 100;
    if (receipt.amount < 50000) return 100;
    if (receipt.amount < 500000) return 200;
    return 300;
  };

  const needsSpamFee = (type: string) => ["release_specific", "refund", "reject"].includes(type);
  const needsReason = (type: string) => ["release_specific", "refund", "reject"].includes(type);

  // Start decision flow
  const startDecision = (type: string) => {
    setDecisionType(type);
    setDecisionReason("");
    setDecisionAmount("");
    setDecisionEvidence([]);
    setDecisionPreviews([]);

    if (needsReason(type)) {
      setShowDecisionForm(true);
    } else {
      // Direct decisions (release_all, delivered, accept) - require PIN first
      requirePin("Confirm Decision", "Enter your PIN to confirm this decision.", () => {
        submitDecision(type, "", "");
      });
    }
  };

  // Upload evidence
  const uploadEvidence = async (disputeId: string) => {
    for (const file of decisionEvidence) {
      const path = `${disputeId}/${Date.now()}-${file.name}`;
      const { error } = await db.storage.from("evidence").upload(path, file, {
        contentType: "image/webp",
      });
      if (!error) {
        await db.from("evidence").insert({
          dispute_id: disputeId,
          file_path: path,
          uploaded_by: user!.id,
          type: "image",
        });
      }
    }
  };

  // Ensure a dispute record exists for the receipt
  const ensureDispute = async (reason: string, type: string, amt: string): Promise<string | null> => {
    // Check if dispute already exists
    if (dispute?.id) return dispute.id;

    const { data: newDispute } = await db.from("disputes").insert({
      receipt_id: receipt.id,
      initiated_by: user!.id,
      reason: reason || type,
      proposed_action: type,
      proposed_amount: type === "release_specific" ? parseFloat(amt) : null,
      status: "open",
      expires_at: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
      auto_execute_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    }).select().single();

    if (newDispute) {
      setDispute(newDispute);
      return newDispute.id;
    }
    return null;
  };

  // Submit decision (after PIN + spam fee verified)
  const submitDecision = async (type: string, reason: string, amount: string) => {
    setSubmittingDecision(true);
    const isSenderDecision = isSender;

    // if this decision requires a spam fee ensure it has been paid
    if (needsSpamFee(type)) {
      const { data: rec, error: feeErr } = await db
        .from("receipts")
        .select("spam_fee_paid, spam_fee_decision")
        .eq("id", receipt.id)
        .maybeSingle();
      if (feeErr || !rec?.spam_fee_paid || rec.spam_fee_decision !== type) {
        toast.error("Anti‑spam fee not found or mismatched. Please complete payment first.");
        setSubmittingDecision(false);
        return;
      }
    }

    try {
      const updateData: any = {};

      if (isSenderDecision) {
        updateData.sender_decision = type;
        updateData.sender_decision_reason = reason || null;
        updateData.sender_decision_amount = type === "release_specific" ? parseFloat(amount) : null;
      } else {
        updateData.receiver_decision = type;
        updateData.receiver_decision_reason = reason || null;
      }

      // Compute current state after this decision
      const currentSenderDec = isSenderDecision ? type : receipt.sender_decision;
      const currentReceiverDec = isSenderDecision ? receipt.receiver_decision : type;

      let newStatus = receipt.status;
      let shouldRelease = false;

      // === ACTIVE STATUS LOGIC ===
      if (receipt.status === "active") {
        // (1 and 4) or (4 and 1) => completed
        if (currentSenderDec === "release_all" && currentReceiverDec === "delivered") {
          shouldRelease = true;
          newStatus = "completed";
        }
        // (1 alone) => release_all, no need for receiver response, but wait 2 days
        // (4 alone) => delivered, wait 2 days for sender response
        // (2 or 3 alone) => wait for receiver 5/6, set timer
        // (2/3 and 5) or (5 and 2/3) => completed
        else if ((currentSenderDec === "release_specific" || currentSenderDec === "refund") && currentReceiverDec === "accept") {
          shouldRelease = true;
          newStatus = "completed";
        }
        // (2/3 and 6) or (6 and 2/3) => dispute
        else if ((currentSenderDec === "release_specific" || currentSenderDec === "refund") && currentReceiverDec === "reject") {
          newStatus = "dispute";
          updateData.decision_auto_execute_at = null;
        }
        // (1 alone without 4) => set 2-day timer if not already set
        // (4 alone without 1) => set 2-day timer if not already set
        // (2 or 3 alone without 5/6) => set 2-day timer
        else if (!shouldRelease) {
          // Set auto-execute timer (2 days) if a single-party decision was just made
          if ((currentSenderDec && !currentReceiverDec) || (!currentSenderDec && currentReceiverDec)) {
            updateData.decision_auto_execute_at = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
          }
        }
      }
      // === DISPUTE STATUS LOGIC ===
      else if (receipt.status === "dispute") {
        // During dispute, sender can choose 1 (release_all) to end it immediately
        if (currentSenderDec === "release_all") {
          shouldRelease = true;
          newStatus = "completed";
        }
        // (2/3 and 5) => completed
        else if ((currentSenderDec === "release_specific" || currentSenderDec === "refund") && currentReceiverDec === "accept") {
          shouldRelease = true;
          newStatus = "completed";
        }
        // (2/3 and 6) => stays dispute (both still disagree)
        // No status change needed
      }

      // Clear timer if both parties have decided
      if (currentSenderDec && currentReceiverDec) {
        updateData.decision_auto_execute_at = null;
      }

      updateData.status = newStatus;

      await db.from("receipts").update(updateData).eq("id", receipt.id);

      // Create dispute record if status changed to "dispute"
      if (newStatus === "dispute" && receipt.status !== "dispute") {
        const disputeId = await ensureDispute(reason, type, amount);
        if (disputeId && decisionEvidence.length > 0) {
          await uploadEvidence(disputeId);
        }
      } else if (decisionEvidence.length > 0 && dispute?.id) {
        // Upload evidence to existing dispute
        await uploadEvidence(dispute.id);
      }

      // If release logic is true, call payscrow-release
      if (shouldRelease) {
        const releaseDecision = currentSenderDec === "release_all" ? "release_all" :
          currentSenderDec === "release_specific" ? "release_specific" : "refund";

        try {
          await supabase.functions.invoke("payscrow-release", {
            body: {
              receiptId: receipt.id,
              decision: releaseDecision,
              amount: releaseDecision === "release_specific"
                ? (isSenderDecision ? parseFloat(amount) : receipt.sender_decision_amount)
                : null,
            },
          });
        } catch (e) {
          console.error("Release function error:", e);
        }
      }

      // Send notification email
      try {
        await supabase.functions.invoke("send-notification-email", {
          body: {
            type: newStatus === "dispute" ? "dispute_started" : shouldRelease ? "dispute_resolved" : "decision_made",
            receiptId: receipt.id,
            decision: type,
            reason: reason || undefined,
            decidedBy: isSenderDecision ? "sender" : "receiver",
          },
        });
      } catch (e) {
        console.error("Notification error:", e);
      }

      toast.success(shouldRelease ? "Decision made! Funds being processed via Payscrow." : "Decision recorded!");
      setShowDecisionForm(false);
      await fetchReceipt();
    } catch (err) {
      console.error(err);
      toast.error("Failed to submit decision");
    }
    setSubmittingDecision(false);
  };

  // Form submit for decisions requiring reason/evidence + spam fee
  const handleDecisionFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (needsSpamFee(decisionType)) {
      // if fee already paid (and recorded) we can bypass Paystack
      if (receipt.spam_fee_paid && receipt.spam_fee_decision === decisionType) {
        requirePin("Confirm Decision", "Enter your PIN to submit this decision.", () => {
          submitDecision(decisionType, decisionReason, decisionAmount);
        });
        return;
      }

      requirePin("Confirm Decision", "Enter your PIN to pay the anti-spam fee and submit your decision.", async () => {
        try {
          const { data, error } = await supabase.functions.invoke("paystack-initialize-spam-fee", {
            body: {
              callbackUrl: `${window.location.origin}/receipt/${receipt.id}`,
              receiptId: receipt.id,
              decisionType,
            },
          });

          if (error || !data?.authorization_url) {
            toast.error(data?.error || "Failed to initialize fee payment");
            return;
          }

          // Store pending decision in sessionStorage so we can resume after Paystack redirect
          sessionStorage.setItem("pending_decision", JSON.stringify({
            receiptId: receipt.id,
            type: decisionType,
            reason: decisionReason,
            amount: decisionAmount,
            reference: data.reference,
          }));

          window.location.href = data.authorization_url;
        } catch {
          toast.error("Fee payment failed");
        }
      });
    } else {
      requirePin("Confirm Decision", "Enter your PIN to submit this decision.", () => {
        submitDecision(decisionType, decisionReason, decisionAmount);
      });
    }
  };

  // Sender action buttons
  const getSenderActions = () => {
    if (!isSender) return null;
    if (receipt.status === "unresolved" || receipt.status === "completed" || receipt.status === "pending") return null;

    // During active: show if no decision yet
    // During dispute: ALWAYS show (allow re-decision)
    if (receipt.status === "active" && receipt.sender_decision) return null;

    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">
          {receipt.status === "dispute" ? "Change your decision:" : "Your decision:"}
        </p>
        <Button variant="hero" size="lg" className="w-full" onClick={() => startDecision("release_all")}>
          <CheckCircle className="w-5 h-5" /> Release Full Payment
        </Button>
        <Button variant="outline" size="lg" className="w-full" onClick={() => startDecision("release_specific")}>
          <Send className="w-5 h-5" /> Release Specific Amount
        </Button>
        <Button variant="destructive" size="lg" className="w-full" onClick={() => startDecision("refund")}>
          <XCircle className="w-5 h-5" /> Request Full Refund
        </Button>
      </div>
    );
  };

  // Receiver action buttons
  const getReceiverActions = () => {
    if (!isReceiver) return null;
    if (receipt.status === "unresolved" || receipt.status === "completed" || receipt.status === "pending") return null;

    // During active: show if no decision yet
    // During dispute: ALWAYS show (allow re-decision - show 5/6)
    if (receipt.status === "active" && receipt.receiver_decision) return null;

    const senderChosePartialOrRefund = receipt.sender_decision === "release_specific" || receipt.sender_decision === "refund";

    // If sender chose 2 or 3, OR we're in dispute status, show Accept/Reject
    if (senderChosePartialOrRefund || receipt.status === "dispute") {
      return (
        <div className="space-y-3">
          {receipt.sender_decision && (
            <div className="bg-warning/10 rounded-xl p-4">
              <p className="text-sm font-semibold text-foreground mb-1">Sender's Decision</p>
              <p className="text-sm text-muted-foreground">
                {receipt.sender_decision === "refund"
                  ? "The sender is requesting a full refund."
                  : receipt.sender_decision === "release_specific"
                    ? `The sender wants to release only ${formatNaira(receipt.sender_decision_amount || 0)} of ${formatNaira(receipt.amount)}.`
                    : `The sender chose: ${receipt.sender_decision}`}
              </p>
              {receipt.sender_decision_reason && (
                <p className="text-xs text-muted-foreground mt-2 italic">"{receipt.sender_decision_reason}"</p>
              )}
            </div>
          )}
          <p className="text-sm font-medium text-foreground">
            {receipt.status === "dispute" ? "Change your response:" : "Your response:"}
          </p>
          <Button variant="hero" size="lg" className="w-full" onClick={() => startDecision("accept")}>
            <CheckCircle className="w-5 h-5" /> Accept
          </Button>
          <Button variant="destructive" size="lg" className="w-full" onClick={() => startDecision("reject")}>
            <XCircle className="w-5 h-5" /> Reject {receipt.spam_fee_paid && receipt.spam_fee_decision === "reject" ? "(fee paid)" : `(₦${getSpamFee().toLocaleString()} fee)`}\\
          </Button>
        </div>
      );
    }

    // Default: show "I Have Delivered" (decision 4)
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Your decision:</p>
        <Button variant="hero" size="lg" className="w-full" onClick={() => startDecision("delivered")}>
          <CheckCircle className="w-5 h-5" /> I Have Delivered
        </Button>
      </div>
    );
  };

  // Decision display
  const getDecisionDisplay = () => {
    if (!receipt.sender_decision && !receipt.receiver_decision) return null;
    const decisionLabels: Record<string, string> = {
      release_all: "Release Full Payment",
      release_specific: `Release ${formatNaira(receipt.sender_decision_amount || 0)}`,
      refund: "Full Refund",
      delivered: "I Have Delivered",
      accept: "Accepted",
      reject: "Rejected",
    };
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Decisions Made</p>
        {receipt.sender_decision && (
          <div className="bg-secondary rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-primary">Sender</span>
            </div>
            <p className="font-semibold text-sm text-foreground">{decisionLabels[receipt.sender_decision] || receipt.sender_decision}</p>
            {receipt.sender_decision_reason && <p className="text-xs text-muted-foreground mt-1 italic">"{receipt.sender_decision_reason}"</p>}
          </div>
        )}
        {receipt.receiver_decision && (
          <div className="bg-secondary rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-accent">Receiver</span>
            </div>
            <p className="font-semibold text-sm text-foreground">{decisionLabels[receipt.receiver_decision] || receipt.receiver_decision}</p>
            {receipt.receiver_decision_reason && <p className="text-xs text-muted-foreground mt-1 italic">"{receipt.receiver_decision_reason}"</p>}
          </div>
        )}
      </div>
    );
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            {getDecisionDisplay()}

            {receipt.decision_auto_execute_at && receipt.status === "active" && (
              <DisputeTimer expiresAt={receipt.decision_auto_execute_at} autoExecuteAt={receipt.decision_auto_execute_at} status="active" />
            )}

            {dispute && (receipt.status === "dispute" || receipt.status === "unresolved") && (
              <DisputeTimer expiresAt={dispute.expires_at} autoExecuteAt={dispute.auto_execute_at} status={dispute.status} />
            )}

            {/* Pay Now */}
            {isSender && receipt.status === "pending" && (
              <Button variant="hero" size="lg" className="w-full" onClick={handlePayNow} disabled={paying}>
                {paying ? <><Loader2 className="w-5 h-5 animate-spin" /> Initializing...</> : <><CreditCard className="w-5 h-5" /> Pay Now</>}
              </Button>
            )}

            {getSenderActions()}
            {getReceiverActions()}

            {/* Decision form */}
            <AnimatePresence>
              {showDecisionForm && (
                <motion.form
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  onSubmit={handleDecisionFormSubmit}
                  className="space-y-4 bg-card rounded-2xl shadow-card p-6 border border-border"
                >
                  <h3 className="font-display font-semibold text-foreground">
                    {decisionType === "release_specific" ? "Release Specific Amount" :
                     decisionType === "refund" ? "Request Refund" : "Reject Decision"}
                  </h3>

                  {needsSpamFee(decisionType) && receipt.spam_fee_paid && receipt.spam_fee_decision === decisionType ? (
                    <div className="bg-success/10 rounded-xl p-3 flex gap-2">
                      <CheckCircle className="w-4 h-4 text-success shrink-0 mt-0.5" />
                      <p className="text-xs text-success-foreground">
                        Anti‑spam fee has already been paid for this decision.
                      </p>
                    </div>
                  ) : needsSpamFee(decisionType) ? (
                    <div className="bg-warning/10 rounded-xl p-3 flex gap-2">
                      <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground">
                        A fee of <strong>₦{getSpamFee().toLocaleString()}</strong> will be charged via Paystack to prevent abuse.
                      </p>
                    </div>
                  ) : null}

                  {decisionType === "release_specific" && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Amount to release (₦)</label>
                      <Input type="number" min={1000} max={receipt.amount} placeholder="Amount" value={decisionAmount} onChange={(e) => setDecisionAmount(e.target.value)} required className="h-12 text-lg font-semibold" />
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Reason</label>
                    <Textarea placeholder="Explain your decision..." value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} required rows={3} />
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-medium text-foreground">Evidence (optional)</label>
                    <div className="flex gap-3">
                      <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="flex-1">
                        <Upload className="w-4 h-4" /> Upload
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => cameraInputRef.current?.click()} className="flex-1">
                        <Camera className="w-4 h-4" /> Camera
                      </Button>
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
                    <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />
                    {decisionPreviews.length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        {decisionPreviews.map((url, i) => (
                          <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                            <img src={url} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                            <button type="button" onClick={() => removeFile(i)} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-destructive flex items-center justify-center">
                              <X className="w-3 h-3 text-destructive-foreground" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <Button type="button" variant="outline" size="lg" className="flex-1" onClick={() => setShowDecisionForm(false)}>Cancel</Button>
                    <Button type="submit" variant="hero" size="lg" className="flex-1" disabled={submittingDecision}>
                      {submittingDecision ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</> : "Submit"}
                    </Button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>

            {/* Edit pending receipt */}
            {receipt.status === "pending" && isCreator && !editing && (
              <Button variant="outline" size="lg" className="w-full" onClick={() => {
                setEditAmount(receipt.amount.toString());
                setEditDescription(receipt.description);
                setEditing(true);
              }}>
                <Edit className="w-5 h-5" /> Edit Receipt
              </Button>
            )}

            {editing && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3 bg-card rounded-2xl p-6 shadow-card border border-border">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Amount (₦)</label>
                  <Input type="number" min={1000} value={editAmount} onChange={(e) => setEditAmount(e.target.value)} className="h-12" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Description</label>
                  <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button variant="hero" className="flex-1" onClick={handleUpdate} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                  </Button>
                </div>
              </motion.div>
            )}

            {receipt.status === "pending" && isCreator && (
              <Button variant="destructive" size="lg" className="w-full" onClick={handleDelete}>
                <Trash2 className="w-5 h-5" /> Delete Receipt
              </Button>
            )}

            <Button variant="secondary" className="w-full" onClick={handleCopyLink}>
              <Copy className="w-4 h-4" /> Copy Receipt Link
            </Button>
          </motion.div>
        </div>
      </div>

      <PinVerifyDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        onVerified={() => { if (pendingAction) pendingAction(); setPendingAction(null); }}
        title={pinTitle}
        description={pinDesc}
      />
    </AppLayout>
  );
};

export default ReceiptView;
