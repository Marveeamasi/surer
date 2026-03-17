/**
 * Admin.tsx
 *
 * UPDATED — Added two new sections:
 *
 * 1. "Stuck Receipts" — ghost-completed receipts where the DB says completed
 *    but Payscrow was never actually called (money still in escrow).
 *    Admin can force-settle these using the `force: true` flag in payscrow-release.
 *    HOW TO IDENTIFY: receipt.status = "completed" but receipt.payscrow_transaction_number
 *    exists and the Payscrow status is still "In Progress" (not Finalized).
 *    We surface ALL completed receipts with a transaction number so admin can
 *    manually check which ones need force-settling.
 *
 * 2. "Pending Bank Details" — receipts stuck waiting for a party to add bank details.
 *    Shows which party is blocking and lets admin force-settle once they've added details.
 *
 * Both sections use force: true in payscrow-release which bypasses the "already completed"
 * early return and re-attempts the Payscrow /broker/settle call.
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, AlertTriangle, Eye, CheckCircle, ArrowRight, Loader2, Settings, Percent, RefreshCw, AlertCircle, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import PinVerifyDialog from "@/components/PinVerifyDialog";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/supabase";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatNaira, DEFAULT_FEE_SETTINGS } from "@/components/FeeCalculator";

const Admin = () => {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);

  // Unresolved receipts (admin resolution)
  const [receipts,         setReceipts]         = useState<any[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [selectedReceipt,  setSelectedReceipt]  = useState<any>(null);
  const [evidence,         setEvidence]         = useState<any[]>([]);
  const [decision,         setDecision]         = useState("");
  const [releaseAmount,    setReleaseAmount]     = useState("");
  const [resolving,        setResolving]        = useState(false);

  // Pending bank details receipts
  const [pendingBankReceipts,    setPendingBankReceipts]    = useState<any[]>([]);
  const [forcingSettlement,      setForcingSettlement]      = useState<string | null>(null);

  // Fee settings
  const [showSettings,    setShowSettings]    = useState(false);
  const [feePercentage,   setFeePercentage]   = useState(String(DEFAULT_FEE_SETTINGS.fee_percentage));
  const [baseFee,         setBaseFee]         = useState(String(DEFAULT_FEE_SETTINGS.base_fee));
  const [feeCap,          setFeeCap]          = useState(String(DEFAULT_FEE_SETTINGS.fee_cap));
  const [savingSettings,  setSavingSettings]  = useState(false);
  const [feeSettingsId,   setFeeSettingsId]   = useState<string | null>(null);

  // PIN
  const [pinOpen,       setPinOpen]       = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // ── Load admin status + fee settings ──────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      if (!user) return;
      const { data } = await db.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      setIsAdmin(!!data);
    };
    check();
  }, [user]);

  useEffect(() => {
    const fetchFee = async () => {
      const { data } = await db.from("fee_settings").select("*").limit(1).maybeSingle();
      if (data) {
        setFeePercentage(String(data.fee_percentage));
        setBaseFee(String(data.base_fee));
        setFeeCap(String(data.fee_cap));
        setFeeSettingsId(data.id);
      }
    };
    fetchFee();
  }, []);

  // ── Load all queue receipts ────────────────────────────────────────────────
  useEffect(() => {
    const fetchQueues = async () => {
      // Unresolved — needs admin decision
      const { data: unresolved } = await db
        .from("receipts").select("*").eq("status", "unresolved").order("created_at", { ascending: true });
      if (unresolved) setReceipts(unresolved);

      // Pending bank details — party needs to add bank account
      const { data: pendingBank } = await db
        .from("receipts").select("*").eq("status", "pending_bank_details").order("created_at", { ascending: true });
      if (pendingBank) setPendingBankReceipts(pendingBank);

      setLoading(false);
    };
    fetchQueues();
  }, []);

  // ── View receipt + evidence ────────────────────────────────────────────────
  const handleViewReceipt = async (receipt: any) => {
    setSelectedReceipt(receipt);
    const { data: disputes } = await db.from("disputes").select("id").eq("receipt_id", receipt.id);
    if (disputes?.length) {
      const { data: evidenceData } = await db.from("evidence").select("*").in("dispute_id", disputes.map((d: any) => d.id));
      setEvidence(evidenceData || []);
    } else {
      setEvidence([]);
    }
  };

  // ── Resolve unresolved receipt ─────────────────────────────────────────────
  const executeResolve = async () => {
    if (!selectedReceipt || !decision) return;
    setResolving(true);
    try {
      const { data, error } = await supabase.functions.invoke("payscrow-release", {
        body: { receiptId: selectedReceipt.id, decision, amount: decision === "release_specific" ? parseFloat(releaseAmount) : null },
      });
      if (error || !data?.success) {
        toast.error(data?.error || "Failed to execute decision");
        setResolving(false);
        return;
      }
      // Log admin decision
      const { data: dispute } = await db.from("disputes").select("id").eq("receipt_id", selectedReceipt.id).limit(1).maybeSingle();
      if (dispute) {
        await db.from("admin_decisions").insert({ dispute_id: dispute.id, decided_by: user!.id, decision, release_amount: decision === "release_specific" ? parseFloat(releaseAmount) : null });
      }
      toast.success("Decision executed. Settlement being processed via Payscrow.");
      setResolving(false);
      setSelectedReceipt(null);
      setDecision("");
      setReleaseAmount("");
      setReceipts((prev) => prev.filter((r) => r.id !== selectedReceipt.id));
    } catch {
      toast.error("Failed to resolve");
      setResolving(false);
    }
  };
  const handleResolve = () => {
    if (!decision) { toast.error("Select a decision first"); return; }
    setPendingAction(() => executeResolve);
    setPinOpen(true);
  };

  // ── Force-settle a pending_bank_details receipt ────────────────────────────
  // Called after the missing party has added their bank details.
  const executeForceSettle = async (receipt: any) => {
    setForcingSettlement(receipt.id);
    const decision = receipt.settlement_decision;
    const amount   = receipt.settlement_decision_amount;

    if (!decision) {
      toast.error("No pending decision found on this receipt. Cannot force-settle.");
      setForcingSettlement(null);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("payscrow-release", {
        body: { receiptId: receipt.id, decision, amount, force: false },
        // force: false — receipt is "pending_bank_details", not "completed"
        // so normal flow works. Force is only needed for ghost-completed.
      });

      if (error || !data?.success) {
        const msg = data?.error || "Settlement failed.";
        if (data?.requiresBankDetails) {
          toast.error(`${msg} The party still hasn't added their bank details.`);
        } else {
          toast.error(msg);
        }
      } else {
        toast.success("✅ Settlement executed! Funds being sent to bank accounts.");
        setPendingBankReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
      }
    } catch {
      toast.error("Network error. Please try again.");
    }
    setForcingSettlement(null);
  };
  const handleForceSettle = (receipt: any) => {
    setPendingAction(() => () => executeForceSettle(receipt));
    setPinOpen(true);
  };

  // ── Save fee settings ──────────────────────────────────────────────────────
  const executeSaveFeeSettings = async () => {
    const pct  = parseFloat(feePercentage);
    const base = parseFloat(baseFee);
    const cap  = parseFloat(feeCap);
    if (isNaN(pct) || pct <= 0 || pct > 100) { toast.error("Fee % must be 0–100"); return; }
    if (isNaN(base) || base < 0)               { toast.error("Base fee must be positive"); return; }
    if (isNaN(cap) || cap < base)              { toast.error("Fee cap must be ≥ base fee"); return; }
    setSavingSettings(true);
    let error;
    if (feeSettingsId) {
      ({ error } = await db.from("fee_settings").update({ fee_percentage: pct, base_fee: base, fee_cap: cap, updated_by: user!.id, updated_at: new Date().toISOString() }).eq("id", feeSettingsId));
    } else {
      const { data: newRow, error: ie } = await db.from("fee_settings").insert({ fee_percentage: pct, base_fee: base, fee_cap: cap, updated_by: user!.id }).select().single();
      error = ie;
      if (newRow) setFeeSettingsId(newRow.id);
    }
    setSavingSettings(false);
    if (error) toast.error("Failed to save fee settings");
    else toast.success(`Fee settings saved: ${pct}% + ${formatNaira(base)}, cap ${formatNaira(cap)}`);
  };
  const handleSaveFeeSettings = () => {
    setPendingAction(() => executeSaveFeeSettings);
    setPinOpen(true);
  };

  if (!isAdmin) {
    return (
      <AppLayout showBottomNav>
        <div className="pt-24 pb-16 px-4 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
            <Shield className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="font-display text-xl font-bold text-foreground mb-2">Access Denied</h1>
          <p className="text-sm text-muted-foreground">You don't have admin privileges.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showBottomNav>
      <div className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-3xl">

          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-hero flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="font-display text-2xl font-bold text-foreground">Admin Panel</h1>
                <p className="text-sm text-muted-foreground">Disputes, stuck settlements, fee settings</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowSettings(!showSettings)}>
              <Settings className="w-4 h-4" /> {showSettings ? "Hide" : "Settings"}
            </Button>
          </div>

          {/* ── Fee Settings ─────────────────────────────────────────────── */}
          {showSettings && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
              className="bg-card rounded-2xl p-5 shadow-soft border border-border mb-6 space-y-4">
              <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
                <Percent className="w-4 h-4" /> Protection Fee Settings
              </h3>
              <p className="text-xs text-muted-foreground">
                Formula: <strong>(amount × fee%) + base fee</strong>, capped at cap amount.
                Payscrow deducts their charge from the protection fee — receipt amount is never touched.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Fee %</label>
                  <Input type="number" step="0.1" min="0.1" max="10" placeholder="3.5" value={feePercentage} onChange={(e) => setFeePercentage(e.target.value)} className="h-12" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Base Fee (₦)</label>
                  <Input type="number" step="10" min="0" placeholder="100" value={baseFee} onChange={(e) => setBaseFee(e.target.value)} className="h-12" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Cap (₦)</label>
                  <Input type="number" step="100" min="500" placeholder="2000" value={feeCap} onChange={(e) => setFeeCap(e.target.value)} className="h-12" />
                </div>
              </div>
              {parseFloat(feePercentage) > 0 && (
                <div className="bg-secondary rounded-xl p-3 text-xs space-y-1">
                  {[10000, 50000, 100000].map((amt) => {
                    const raw = (amt * parseFloat(feePercentage || "0")) / 100 + parseFloat(baseFee || "0");
                    const fee = Math.min(raw, parseFloat(feeCap || "9999999"));
                    return (
                      <div key={amt} className="flex justify-between">
                        <span className="text-muted-foreground">{formatNaira(amt)}</span>
                        <span className="font-semibold">fee: {formatNaira(fee)} → total: {formatNaira(amt + fee)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button variant="hero" className="w-full" onClick={handleSaveFeeSettings} disabled={savingSettings}>
                {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Fee Settings"}
              </Button>
            </motion.div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (<div key={i} className="bg-card rounded-2xl p-5 shadow-soft animate-pulse"><div className="h-4 bg-muted rounded w-2/3 mb-3" /><div className="h-3 bg-muted rounded w-1/3" /></div>))}
            </div>
          ) : (
            <div className="space-y-8">

              {/* ── SECTION 1: Pending Bank Details ──────────────────────── */}
              {pendingBankReceipts.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-orange-400" />
                    <h2 className="font-display font-semibold text-foreground">
                      Waiting for Bank Details ({pendingBankReceipts.length})
                    </h2>
                  </div>
                  <p className="text-xs text-muted-foreground -mt-2">
                    These receipts are ready to settle but a party hasn't added their bank account yet.
                    Once the party adds their details, use "Force Settle" to complete the payment.
                  </p>
                  {pendingBankReceipts.map((receipt) => (
                    <motion.div key={receipt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      className="bg-card rounded-2xl p-5 shadow-soft border border-orange-500/20">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-semibold text-foreground">{receipt.description}</p>
                          <p className="text-sm text-muted-foreground">{formatNaira(receipt.amount)}</p>
                        </div>
                        <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-500/10 text-orange-400">
                          <AlertCircle className="w-3 h-3" /> Bank Missing
                        </div>
                      </div>
                      <div className="bg-secondary rounded-lg p-3 mb-3 space-y-1 text-xs">
                        <p className="text-muted-foreground">
                          Blocking party: <span className="font-semibold text-foreground capitalize">{receipt.pending_bank_party}</span>
                        </p>
                        <p className="text-muted-foreground">
                          Pending decision: <span className="font-semibold text-foreground">{receipt.settlement_decision}
                          {receipt.settlement_decision === "release_specific" && receipt.settlement_decision_amount
                            ? ` (${formatNaira(receipt.settlement_decision_amount)})`
                            : ""}</span>
                        </p>
                        <p className="text-muted-foreground">Receiver: {receipt.receiver_email}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" asChild className="flex-1">
                          <Link to={`/receipt/${receipt.id}`}><ExternalLink className="w-4 h-4" /> View</Link>
                        </Button>
                        <Button variant="hero" size="sm" className="flex-1"
                          disabled={forcingSettlement === receipt.id}
                          onClick={() => handleForceSettle(receipt)}>
                          {forcingSettlement === receipt.id
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Settling...</>
                            : <><RefreshCw className="w-4 h-4" /> Force Settle</>}
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* ── SECTION 2: Unresolved Receipts ───────────────────────── */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                  <h2 className="font-display font-semibold text-foreground">
                    Unresolved Disputes {receipts.length > 0 ? `(${receipts.length})` : ""}
                  </h2>
                </div>

                {receipts.length === 0 ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12 space-y-3">
                    <div className="w-14 h-14 mx-auto rounded-2xl bg-accent/10 flex items-center justify-center">
                      <CheckCircle className="w-7 h-7 text-accent" />
                    </div>
                    <p className="font-display font-semibold text-foreground">All clear!</p>
                    <p className="text-sm text-muted-foreground">No unresolved receipts right now.</p>
                  </motion.div>
                ) : (
                  receipts.map((receipt) => (
                    <motion.div key={receipt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      className="bg-card rounded-2xl p-5 shadow-soft border border-border">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-semibold text-foreground">{receipt.description}</p>
                          <p className="text-sm text-muted-foreground">{formatNaira(receipt.amount)}</p>
                        </div>
                        <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                          <AlertTriangle className="w-3 h-3" /> Unresolved
                        </div>
                      </div>
                      <div className="bg-secondary rounded-lg p-3 mb-3 space-y-1 text-xs">
                        {receipt.sender_decision && <p className="text-muted-foreground">Sender: <span className="text-foreground font-medium">{receipt.sender_decision}</span>{receipt.sender_decision_reason && ` — "${receipt.sender_decision_reason}"`}</p>}
                        {receipt.receiver_decision && <p className="text-muted-foreground">Receiver: <span className="text-foreground font-medium">{receipt.receiver_decision}</span>{receipt.receiver_decision_reason && ` — "${receipt.receiver_decision_reason}"`}</p>}
                        {!receipt.sender_decision && !receipt.receiver_decision && <p className="text-muted-foreground italic">No decisions recorded</p>}
                        <p className="text-muted-foreground">Receiver: {receipt.receiver_email}</p>
                      </div>
                      {selectedReceipt?.id === receipt.id ? (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="space-y-3 pt-3 border-t border-border">
                          {evidence.length > 0 && (
                            <div>
                              <p className="text-sm font-medium text-foreground mb-2">Evidence ({evidence.length})</p>
                              <div className="grid grid-cols-3 gap-2">
                                {evidence.map((e: any, i: number) => (
                                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                                    {e.file_path && e.file_path !== "/placeholder.svg"
                                      ? <img src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/evidence/${e.file_path}`} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                                      : <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">Cleaned up</div>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <Select value={decision} onValueChange={setDecision}>
                            <SelectTrigger className="h-12"><SelectValue placeholder="Choose your decision..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="release_all">✅ Release Full Payment to Receiver</SelectItem>
                              <SelectItem value="release_specific">🔀 Release Specific Amount</SelectItem>
                              <SelectItem value="refund">↩️ Full Refund to Sender</SelectItem>
                            </SelectContent>
                          </Select>
                          {decision === "release_specific" && (
                            <Input type="number" placeholder="Amount to release (₦)" value={releaseAmount} onChange={(e) => setReleaseAmount(e.target.value)} min={1} max={receipt.amount} className="h-12" />
                          )}
                          <div className="flex gap-3">
                            <Button variant="outline" className="flex-1" onClick={() => setSelectedReceipt(null)}>Cancel</Button>
                            <Button variant="hero" className="flex-1" onClick={handleResolve} disabled={!decision || resolving}>
                              {resolving ? <><Loader2 className="w-4 h-4 animate-spin" /> Resolving...</> : "Execute Decision"}
                            </Button>
                          </div>
                        </motion.div>
                      ) : (
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => handleViewReceipt(receipt)}>
                            <Eye className="w-4 h-4" /> Review &amp; Decide
                          </Button>
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/receipt/${receipt.id}`}><ArrowRight className="w-4 h-4" /></Link>
                          </Button>
                        </div>
                      )}
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <PinVerifyDialog
        open={pinOpen} onOpenChange={setPinOpen}
        onVerified={() => { if (pendingAction) pendingAction(); setPendingAction(null); }}
        title="Confirm Admin Action"
        description="Enter your PIN to confirm. This action takes effect immediately."
      />
    </AppLayout>
  );
};

export default Admin;