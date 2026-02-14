import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Shield, CheckCircle, Copy, AlertTriangle, Trash2, CreditCard,
  Edit, X, Send, Loader2, Camera, Upload, Image as ImageIcon, XCircle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import { FeeCalculator, formatNaira } from "@/components/FeeCalculator";
import DisputeTimer from "@/components/DisputeTimer";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/supabase";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ReceiptView = () => {
  const { id } = useParams();
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

  useEffect(() => {
    fetchReceipt();
  }, [id]);

  const isSender = receipt?.sender_id === user?.id;
  const isReceiver = receipt?.receiver_id === user?.id || receipt?.receiver_email === user?.email;
  const isCreator = receipt?.created_by === user?.id;

  // Pay Now handler
  const handlePayNow = async () => {
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

  // Update receipt
  const handleUpdate = async () => {
    setSaving(true);
    const { error } = await db
      .from("receipts")
      .update({
        amount: parseFloat(editAmount),
        description: editDescription,
      })
      .eq("id", receipt.id);
    setSaving(false);
    if (error) toast.error("Failed to update");
    else {
      toast.success("Receipt updated!");
      setEditing(false);
      setReceipt({ ...receipt, amount: parseFloat(editAmount), description: editDescription });
    }
  };

  // Delete receipt
  const handleDelete = async () => {
    const { error } = await db.from("receipts").delete().eq("id", receipt.id);
    if (error) toast.error("Cannot delete");
    else {
      toast.success("Receipt deleted");
      navigate("/dashboard");
    }
  };

  // Copy clean link
  const handleCopyLink = () => {
    const cleanUrl = `${window.location.origin}/receipt/${receipt.id}`;
    navigator.clipboard.writeText(cleanUrl);
    toast.success("Link copied!");
  };

  // File handling for decision evidence
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

  // Needs spam fee: decisions 2, 3, and 6
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
      // Direct decisions (release_all, delivered, accept) - execute immediately
      submitDecision(type, "", "");
    }
  };

  // Upload evidence files
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

  // Submit decision
  const submitDecision = async (type: string, reason: string, amount: string) => {
    setSubmittingDecision(true);
    const isSenderDecision = isSender;

    try {
      // For spam fee decisions, pay via Paystack first
      if (needsSpamFee(type)) {
        // For now we'll record the decision - in production integrate Paystack for fee
        // The fee payment can be verified server-side
      }

      const updateData: any = {};
      if (isSenderDecision) {
        updateData.sender_decision = type;
        updateData.sender_decision_reason = reason || null;
        updateData.sender_decision_amount = type === "release_specific" ? parseFloat(amount) : null;
      } else {
        updateData.receiver_decision = type;
        updateData.receiver_decision_reason = reason || null;
      }

      // Set auto-execute timer (2 days) if no existing timer
      if (!receipt.decision_auto_execute_at) {
        updateData.decision_auto_execute_at = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      }

      // Determine outcome based on current + new decision
      const currentSenderDec = isSenderDecision ? type : receipt.sender_decision;
      const currentReceiverDec = isSenderDecision ? receipt.receiver_decision : type;

      let newStatus = receipt.status;
      let shouldRelease = false;

      if (receipt.status === "active") {
        // (1 and 4) or (4 and 1) => release true, completed
        if (currentSenderDec === "release_all" && currentReceiverDec === "delivered") {
          shouldRelease = true;
          newStatus = "completed";
        } else if (currentSenderDec === "release_all" && !currentReceiverDec) {
          // Sender chose release_all, no receiver decision yet - wait or auto-execute in 2 days
          newStatus = "active";
        } else if (!currentSenderDec && currentReceiverDec === "delivered") {
          // Receiver delivered, no sender decision yet - wait or auto-execute in 2 days
          newStatus = "active";
        }
        // When sender makes 2 or 3 and receiver responds 5 => release true
        else if ((currentSenderDec === "release_specific" || currentSenderDec === "refund") && currentReceiverDec === "accept") {
          shouldRelease = true;
          newStatus = "completed";
        }
        // When sender makes 2 or 3 and receiver responds 6 => dispute
        else if ((currentSenderDec === "release_specific" || currentSenderDec === "refund") && currentReceiverDec === "reject") {
          newStatus = "dispute";
          // Clear auto-execute timer since we're entering dispute
          updateData.decision_auto_execute_at = null;
        }
        // Sender chose 2 or 3, receiver hasn't responded yet - replace receiver's 4 with 5/6
        // The UI handles this by showing appropriate buttons
      } else if (receipt.status === "dispute") {
        // In dispute: if accept (5), release true
        if ((currentSenderDec === "release_specific" || currentSenderDec === "refund") && currentReceiverDec === "accept") {
          shouldRelease = true;
          newStatus = "completed";
        }
        // In dispute: if reject again, stays dispute
        else if ((currentSenderDec === "release_specific" || currentSenderDec === "refund") && currentReceiverDec === "reject") {
          newStatus = "dispute";
        }
      }

      updateData.status = newStatus;

      // If the other party responded, clear the auto-execute timer
      if (currentSenderDec && currentReceiverDec) {
        updateData.decision_auto_execute_at = null;
      }

      await db.from("receipts").update(updateData).eq("id", receipt.id);

      // Upload evidence if any
      if (decisionEvidence.length > 0 && dispute?.id) {
        await uploadEvidence(dispute.id);
      } else if (decisionEvidence.length > 0 && newStatus === "dispute") {
        // Create dispute record for evidence storage
        const { data: newDispute } = await db.from("disputes").insert({
          receipt_id: receipt.id,
          initiated_by: user!.id,
          reason: reason || type,
          proposed_action: type,
          proposed_amount: type === "release_specific" ? parseFloat(amount) : null,
          status: "open",
          expires_at: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
          auto_execute_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        }).select().single();
        if (newDispute) {
          await uploadEvidence(newDispute.id);
          setDispute(newDispute);
        }
      }

      // If should release, call edge function
      if (shouldRelease) {
        try {
          await supabase.functions.invoke("payscrow-release", {
            body: {
              receiptId: receipt.id,
              decision: currentSenderDec,
              amount: currentSenderDec === "release_specific" 
                ? (isSenderDecision ? parseFloat(amount) : receipt.sender_decision_amount) 
                : null,
            },
          });
        } catch (e) {
          console.error("Release function error:", e);
        }
      }

      // Send notification email to other party
      try {
        await supabase.functions.invoke("send-notification-email", {
          body: {
            type: "decision_made",
            receiptId: receipt.id,
            decision: type,
            reason: reason || undefined,
            decidedBy: isSenderDecision ? "sender" : "receiver",
          },
        });
      } catch (e) {
        console.error("Notification error:", e);
      }

      toast.success(shouldRelease ? "Decision made! Funds being processed." : "Decision recorded!");
      setShowDecisionForm(false);
      await fetchReceipt();
    } catch (err) {
      console.error(err);
      toast.error("Failed to submit decision");
    }
    setSubmittingDecision(false);
  };

  const handleDecisionFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitDecision(decisionType, decisionReason, decisionAmount);
  };

  // Determine which buttons to show for sender
  const getSenderActions = () => {
    if (!isSender || receipt.status === "unresolved" || receipt.status === "completed" || receipt.status === "pending") return null;

    const hasSenderDecision = !!receipt.sender_decision;
    if (hasSenderDecision) return null; // Already decided

    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Your decision:</p>
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

  // Determine which buttons to show for receiver
  const getReceiverActions = () => {
    if (!isReceiver || receipt.status === "unresolved" || receipt.status === "completed" || receipt.status === "pending") return null;

    const hasReceiverDecision = !!receipt.receiver_decision;
    if (hasReceiverDecision) return null;

    // If sender chose 2 or 3, receiver sees Accept (5) / Reject (6) instead of Delivered (4)
    const senderChosePartialOrRefund = receipt.sender_decision === "release_specific" || receipt.sender_decision === "refund";

    if (senderChosePartialOrRefund) {
      return (
        <div className="space-y-3">
          <div className="bg-warning/10 rounded-xl p-4">
            <p className="text-sm font-semibold text-foreground mb-1">Sender's Decision</p>
            <p className="text-sm text-muted-foreground">
              {receipt.sender_decision === "refund"
                ? "The sender is requesting a full refund."
                : `The sender wants to release only ${formatNaira(receipt.sender_decision_amount || 0)} of ${formatNaira(receipt.amount)}.`}
            </p>
            {receipt.sender_decision_reason && (
              <p className="text-xs text-muted-foreground mt-2 italic">"{receipt.sender_decision_reason}"</p>
            )}
          </div>
          <p className="text-sm font-medium text-foreground">Your response:</p>
          <Button variant="hero" size="lg" className="w-full" onClick={() => startDecision("accept")}>
            <CheckCircle className="w-5 h-5" /> Accept
          </Button>
          <Button variant="destructive" size="lg" className="w-full" onClick={() => startDecision("reject")}>
            <XCircle className="w-5 h-5" /> Reject (₦{getSpamFee().toLocaleString()} fee)
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Your decision:</p>
        <Button variant="hero" size="lg" className="w-full" onClick={() => startDecision("delivered")}>
          <CheckCircle className="w-5 h-5" /> I Have Delivered
        </Button>
      </div>
    );
  };

  // Show existing decisions
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
            {receipt.sender_decision_reason && (
              <p className="text-xs text-muted-foreground mt-1 italic">"{receipt.sender_decision_reason}"</p>
            )}
          </div>
        )}
        {receipt.receiver_decision && (
          <div className="bg-secondary rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-accent">Receiver</span>
            </div>
            <p className="font-semibold text-sm text-foreground">{decisionLabels[receipt.receiver_decision] || receipt.receiver_decision}</p>
            {receipt.receiver_decision_reason && (
              <p className="text-xs text-muted-foreground mt-1 italic">"{receipt.receiver_decision_reason}"</p>
            )}
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

            {/* Decisions display */}
            {getDecisionDisplay()}

            {/* Auto-execute timer for active receipts with decisions */}
            {receipt.decision_auto_execute_at && receipt.status === "active" && (
              <DisputeTimer
                expiresAt={receipt.decision_auto_execute_at}
                autoExecuteAt={receipt.decision_auto_execute_at}
                status="active"
              />
            )}

            {/* Dispute timer */}
            {dispute && (receipt.status === "dispute" || receipt.status === "unresolved") && (
              <DisputeTimer
                expiresAt={dispute.expires_at}
                autoExecuteAt={dispute.auto_execute_at}
                status={dispute.status}
              />
            )}

            {/* Pay Now - for sender on pending receipt */}
            {isSender && receipt.status === "pending" && (
              <Button variant="hero" size="lg" className="w-full" onClick={handlePayNow} disabled={paying}>
                {paying ? <><Loader2 className="w-5 h-5 animate-spin" /> Initializing...</> : <><CreditCard className="w-5 h-5" /> Pay Now</>}
              </Button>
            )}

            {/* Sender actions for active/dispute receipt */}
            {getSenderActions()}

            {/* Receiver actions for active/dispute receipt */}
            {getReceiverActions()}

            {/* Decision form with reason + evidence (for 2, 3, 6) */}
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

                  {needsSpamFee(decisionType) && (
                    <div className="bg-warning/10 rounded-xl p-3 flex gap-2">
                      <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground">
                        A fee of ₦{getSpamFee().toLocaleString()} will be charged to prevent abuse.
                      </p>
                    </div>
                  )}

                  {decisionType === "release_specific" && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Amount to release (₦)</label>
                      <Input
                        type="number"
                        min={1000}
                        max={receipt.amount}
                        placeholder="Amount"
                        value={decisionAmount}
                        onChange={(e) => setDecisionAmount(e.target.value)}
                        required
                        className="h-12 text-lg font-semibold"
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Reason</label>
                    <Textarea
                      placeholder="Explain your decision..."
                      value={decisionReason}
                      onChange={(e) => setDecisionReason(e.target.value)}
                      required
                      rows={3}
                    />
                  </div>

                  {/* Evidence upload */}
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

            {/* Delete pending receipt (only creator) */}
            {receipt.status === "pending" && isCreator && (
              <Button variant="destructive" size="lg" className="w-full" onClick={handleDelete}>
                <Trash2 className="w-5 h-5" /> Delete Receipt
              </Button>
            )}

            {/* Copy link */}
            <Button variant="secondary" className="w-full" onClick={handleCopyLink}>
              <Copy className="w-4 h-4" /> Copy Receipt Link
            </Button>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
};

export default ReceiptView;
