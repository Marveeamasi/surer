/**
 * Admin.tsx
 *
 * THREE QUEUES:
 *
 * 1. GHOST COMPLETED — status="completed" but settlement was never sent to Payscrow.
 *    These receipts have a payscrow_transaction_number but the money is still in escrow.
 *    Admin selects decision (1/2/3) and force-settles with force=true.
 *    This is the fix for your stuck ₦1,000.
 *
 * 2. PENDING BANK DETAILS — status="pending_bank_details".
 *    Party has added bank details, admin triggers force-settle.
 *    settlement_decision and settlement_decision_amount are stored on the receipt.
 *
 * 3. UNRESOLVED DISPUTES — status="unresolved".
 *    4-day dispute window expired, admin picks 1/2/3.
 *
 * All actions are PIN-protected and use payscrow-release edge function.
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Shield, AlertTriangle, Eye, CheckCircle, ArrowRight,
  Loader2, Settings, Percent, RefreshCw, AlertCircle,
  ExternalLink, Ghost, ScrollText, Trash2,
  ChevronLeft, ChevronRight, Search, X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
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

  // Queue 1: Ghost completed receipts
  const [ghostReceipts,      setGhostReceipts]      = useState<any[]>([]);
  const [ghostDecision,      setGhostDecision]      = useState<Record<string, string>>({});
  const [ghostAmount,        setGhostAmount]        = useState<Record<string, string>>({});
  const [ghostSettling,      setGhostSettling]      = useState<string | null>(null);
  const [showGhostForm,      setShowGhostForm]      = useState<string | null>(null);

  // Queue 2: Pending bank details
  const [pendingBankReceipts, setPendingBankReceipts] = useState<any[]>([]);
  const [forcingSettlement,   setForcingSettlement]   = useState<string | null>(null);

  // Queue 3: Unresolved disputes
  const [receipts,        setReceipts]        = useState<any[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<any>(null);
  const [evidence,        setEvidence]        = useState<any[]>([]);
  const [decision,        setDecision]        = useState("");
  const [releaseAmount,   setReleaseAmount]   = useState("");
  const [resolving,       setResolving]       = useState(false);

  const [loading, setLoading] = useState(true);

  // ── Tab ────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"queues" | "logs">("queues");

  // ── Logs ───────────────────────────────────────────────────────────────────
  const LOGS_PER_PAGE = 20;
  const [logs,         setLogs]        = useState<any[]>([]);
  const [logsTotal,    setLogsTotal]   = useState(0);
  const [logsPage,     setLogsPage]    = useState(1);
  const [logsLoading,  setLogsLoading] = useState(false);
  const [logSearch,    setLogSearch]   = useState("");
  const [logLevel,     setLogLevel]    = useState("all");
  const [logContext,   setLogContext]  = useState("");
  const [clearingLogs, setClearingLogs] = useState(false);

  // Fee settings
  const [showSettings,   setShowSettings]   = useState(false);
  const [feePercentage,  setFeePercentage]  = useState(String(DEFAULT_FEE_SETTINGS.fee_percentage));
  const [baseFee,        setBaseFee]        = useState(String(DEFAULT_FEE_SETTINGS.base_fee));
  const [feeCap,         setFeeCap]         = useState(String(DEFAULT_FEE_SETTINGS.fee_cap));
  const [savingSettings, setSavingSettings] = useState(false);
  const [feeSettingsId,  setFeeSettingsId]  = useState<string | null>(null);

  // PIN
  const [pinOpen,       setPinOpen]       = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [pinTitle,      setPinTitle]      = useState("Confirm Admin Action");
  const [pinDesc,       setPinDesc]       = useState("Enter your PIN to confirm.");

  const requirePin = (title: string, desc: string, action: () => void) => {
    setPinTitle(title); setPinDesc(desc);
    setPendingAction(() => action); setPinOpen(true);
  };

  // ── Fetch logs ─────────────────────────────────────────────────────────────
  const fetchLogs = useCallback(async (page = 1) => {
    setLogsLoading(true);
    const from = (page - 1) * LOGS_PER_PAGE;
    const to   = from + LOGS_PER_PAGE - 1;
    let q = db
      .from("app_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (logLevel !== "all") q = q.eq("level", logLevel);
    if (logContext.trim())  q = q.ilike("context", `%${logContext.trim()}%`);
    if (logSearch.trim())   q = q.ilike("message", `%${logSearch.trim()}%`);
    const { data, count } = await q;
    setLogs(data || []); setLogsTotal(count || 0); setLogsPage(page);
    setLogsLoading(false);
  }, [logLevel, logContext, logSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === "logs") fetchLogs(1);
  }, [activeTab, logLevel, logContext]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab !== "logs") return;
    const t = setTimeout(() => fetchLogs(1), 400);
    return () => clearTimeout(t);
  }, [logSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const executeClearLogs = async () => {
    setClearingLogs(true);
    const { error } = await db.from("app_logs").delete().lt("created_at", new Date().toISOString());
    setClearingLogs(false);
    if (error) { toast.error("Failed to clear logs"); return; }
    toast.success("All logs cleared.");
    setLogs([]); setLogsTotal(0); setLogsPage(1);
  };

  // ── Admin check ────────────────────────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      if (!user) return;
      const { data } = await db.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      setIsAdmin(!!data);
    };
    check();
  }, [user]);

  // ── Fee settings ───────────────────────────────────────────────────────────
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

  // ── Load all queues ────────────────────────────────────────────────────────
  const loadQueues = async () => {
    setLoading(true);

    // Queue 1: Ghost completed — completed receipts that have a payscrow transaction
    // but settlement_decision is null (meaning settle was never called successfully).
    // We identify these as: status=completed AND payscrow_transaction_number IS NOT NULL
    // AND settlement_decision IS NULL. These are pre-safety-migration receipts.
    const { data: ghost } = await db
      .from("receipts")
      .select("*")
      .eq("status", "completed")
      .not("payscrow_transaction_number", "is", null)
      .is("settlement_decision", null)
      .is("settlement_initiated_at", null)
      .order("created_at", { ascending: true });
    // Additional filter: only ones where sender_decision exists (money was actually released)
    // This prevents showing truly-completed receipts
    setGhostReceipts((ghost || []).filter((r: any) =>
      r.sender_decision && ["release_all", "release_specific", "refund"].includes(r.sender_decision)
    ));

    // Queue 2: Pending bank details
    const { data: pendingBank } = await db
      .from("receipts").select("*").eq("status", "pending_bank_details").order("created_at", { ascending: true });
    setPendingBankReceipts(pendingBank || []);

    // Queue 3: Unresolved disputes
    const { data: unresolved } = await db
      .from("receipts").select("*").eq("status", "unresolved").order("created_at", { ascending: true });
    setReceipts(unresolved || []);

    setLoading(false);
  };

  useEffect(() => { loadQueues(); }, []);

  // ── QUEUE 1: Force-settle ghost completed receipt ──────────────────────────
  const executeGhostSettle = async (receipt: any) => {
    const dec    = ghostDecision[receipt.id];
    const amt    = ghostAmount[receipt.id];
    if (!dec) { toast.error("Please select a decision first"); return; }
    if (dec === "release_specific" && (!amt || parseFloat(amt) <= 0)) {
      toast.error("Please enter a valid amount"); return;
    }

    setGhostSettling(receipt.id);
    try {
      const { data, error } = await supabase.functions.invoke("payscrow-release", {
        body: {
          receiptId: receipt.id,
          decision:  dec,
          amount:    dec === "release_specific" ? parseFloat(amt) : null,
          force:     true, // bypass "already completed" check
        },
      });

      if (error || !data?.success) {
        const msg = data?.error || "Settlement failed.";
        toast.error(msg);
        console.error("[admin] Ghost settle failed:", data);
      } else {
        toast.success("✅ Settlement sent to Payscrow. Funds are being processed.");
        setGhostReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
        setShowGhostForm(null);
      }
    } catch {
      toast.error("Network error. Please try again.");
    }
    setGhostSettling(null);
  };

  // ── QUEUE 2: Force-settle pending_bank_details receipt ────────────────────
  const executeForceSettle = async (receipt: any) => {
    const dec = receipt.settlement_decision;
    const amt = receipt.settlement_decision_amount;
    if (!dec) {
      toast.error("No pending decision stored. Use the Ghost Completed section instead.");
      return;
    }
    setForcingSettlement(receipt.id);
    try {
      const { data, error } = await supabase.functions.invoke("payscrow-release", {
        body: { receiptId: receipt.id, decision: dec, amount: amt, force: false },
      });
      if (error || !data?.success) {
        const msg = data?.error || "Settlement failed.";
        if (data?.requiresBankDetails) {
          toast.error(`${msg} Party still hasn't added bank details.`);
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

  // ── QUEUE 3: Resolve unresolved dispute ───────────────────────────────────
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
      const { data: dispute } = await db.from("disputes").select("id").eq("receipt_id", selectedReceipt.id).limit(1).maybeSingle();
      if (dispute) {
        await db.from("admin_decisions").insert({
          dispute_id:     dispute.id,
          decided_by:     user!.id,
          decision,
          release_amount: decision === "release_specific" ? parseFloat(releaseAmount) : null,
        });
      }
      toast.success("Decision executed. Settlement being processed via Payscrow.");
      setReceipts((prev) => prev.filter((r) => r.id !== selectedReceipt.id));
      setSelectedReceipt(null); setDecision(""); setReleaseAmount("");
    } catch { toast.error("Failed to resolve"); }
    setResolving(false);
  };

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
    if (error) toast.error("Failed to save");
    else toast.success(`Fee: ${pct}% + ${formatNaira(base)}, cap ${formatNaira(cap)}`);
  };

  const handleViewReceipt = async (receipt: any) => {
    setSelectedReceipt(receipt);
    const { data: disputes } = await db.from("disputes").select("id").eq("receipt_id", receipt.id);
    if (disputes?.length) {
      const { data: evidenceData } = await db.from("evidence").select("*").in("dispute_id", disputes.map((d: any) => d.id));
      setEvidence(evidenceData || []);
    } else setEvidence([]);
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

  const totalIssues = ghostReceipts.length + pendingBankReceipts.length + receipts.length;

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
                <p className="text-sm text-muted-foreground">
                  {totalIssues > 0 ? `${totalIssues} item(s) need attention` : "All clear"}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={loadQueues}>
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowSettings(!showSettings)}>
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* ── Tab bar ─────────────────────────────────────────────────── */}
          <div className="flex gap-1 bg-secondary rounded-xl p-1 mb-6">
            <button onClick={() => setActiveTab("queues")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all ${activeTab === "queues" ? "bg-card shadow-soft text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <Shield className="w-4 h-4" />
              Queues
              {(ghostReceipts.length + pendingBankReceipts.length + receipts.length) > 0 && (
                <span className="bg-destructive text-destructive-foreground text-xs rounded-full px-1.5 py-0.5 leading-none">
                  {ghostReceipts.length + pendingBankReceipts.length + receipts.length}
                </span>
              )}
            </button>
            <button onClick={() => setActiveTab("logs")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all ${activeTab === "logs" ? "bg-card shadow-soft text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <ScrollText className="w-4 h-4" />
              Logs
            </button>
          </div>

          {/* Fee Settings */}
          {showSettings && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
              className="bg-card rounded-2xl p-5 shadow-soft border border-border mb-6 space-y-4">
              <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
                <Percent className="w-4 h-4" /> Protection Fee Settings
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Fee %</label>
                  <Input type="number" step="0.1" min="0.1" max="10" value={feePercentage} onChange={(e) => setFeePercentage(e.target.value)} className="h-12" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Base Fee (₦)</label>
                  <Input type="number" step="10" min="0" value={baseFee} onChange={(e) => setBaseFee(e.target.value)} className="h-12" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Cap (₦)</label>
                  <Input type="number" step="100" min="500" value={feeCap} onChange={(e) => setFeeCap(e.target.value)} className="h-12" />
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
              <Button variant="hero" className="w-full" onClick={() => requirePin("Save Fee Settings", "Enter your PIN to update fees.", executeSaveFeeSettings)} disabled={savingSettings}>
                {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Fee Settings"}
              </Button>
            </motion.div>
          )}

          {activeTab === "queues" && (loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (<div key={i} className="bg-card rounded-2xl p-5 animate-pulse"><div className="h-4 bg-muted rounded w-2/3 mb-3" /><div className="h-3 bg-muted rounded w-1/3" /></div>))}
            </div>
          ) : (
            <div className="space-y-8">

              {/* ═══════════════════════════════════════════════════════════
                  QUEUE 1: GHOST COMPLETED
                  Receipts showing completed in DB but money never left Payscrow.
                  Admin must pick a decision and force-settle.
              ═══════════════════════════════════════════════════════════ */}
              {ghostReceipts.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Ghost className="w-5 h-5 text-purple-400" />
                    <h2 className="font-display font-semibold text-foreground">
                      Ghost Completed — Money Stuck in Escrow ({ghostReceipts.length})
                    </h2>
                  </div>
                  <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 text-xs text-muted-foreground">
                    These receipts show "Completed" in the app but Payscrow was never told to release the funds.
                    Money is still in escrow. Select a decision and force-settle each one.
                  </div>
                  {ghostReceipts.map((receipt) => (
                    <motion.div key={receipt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      className="bg-card rounded-2xl p-5 shadow-soft border border-purple-500/20">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-semibold text-foreground">{receipt.description}</p>
                          <p className="text-sm text-muted-foreground">
                            {formatNaira(receipt.amount)} · {receipt.receiver_email}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Payscrow ref: <span className="font-mono text-foreground">{receipt.payscrow_transaction_number}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400">
                          <Ghost className="w-3 h-3" /> Ghost
                        </div>
                      </div>

                      {/* Decisions recorded */}
                      {(receipt.sender_decision || receipt.receiver_decision) && (
                        <div className="bg-secondary rounded-lg p-3 mb-3 text-xs space-y-1">
                          {receipt.sender_decision && <p className="text-muted-foreground">Sender decided: <span className="font-semibold text-foreground">{receipt.sender_decision}</span></p>}
                          {receipt.receiver_decision && <p className="text-muted-foreground">Receiver decided: <span className="font-semibold text-foreground">{receipt.receiver_decision}</span></p>}
                        </div>
                      )}

                      {showGhostForm === receipt.id ? (
                        <div className="space-y-3 pt-3 border-t border-border">
                          <p className="text-xs text-muted-foreground font-medium">
                            Choose the correct settlement decision based on what both parties agreed to:
                          </p>
                          <Select value={ghostDecision[receipt.id] || ""} onValueChange={(v) => setGhostDecision((prev) => ({ ...prev, [receipt.id]: v }))}>
                            <SelectTrigger className="h-12"><SelectValue placeholder="Choose decision..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="release_all">✅ Release Full Payment to Receiver</SelectItem>
                              <SelectItem value="release_specific">🔀 Release Specific Amount</SelectItem>
                              <SelectItem value="refund">↩️ Full Refund to Sender</SelectItem>
                            </SelectContent>
                          </Select>
                          {ghostDecision[receipt.id] === "release_specific" && (
                            <Input type="number" placeholder={`Amount (max ₦${receipt.amount})`} min={1} max={receipt.amount}
                              value={ghostAmount[receipt.id] || ""}
                              onChange={(e) => setGhostAmount((prev) => ({ ...prev, [receipt.id]: e.target.value }))}
                              className="h-12" />
                          )}
                          <div className="flex gap-3">
                            <Button variant="outline" className="flex-1" onClick={() => setShowGhostForm(null)}>Cancel</Button>
                            <Button variant="hero" className="flex-1" disabled={ghostSettling === receipt.id || !ghostDecision[receipt.id]}
                              onClick={() => requirePin("Force Settle", "This will send the settlement to Payscrow. Irreversible.", () => executeGhostSettle(receipt))}>
                              {ghostSettling === receipt.id
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Settling...</>
                                : <><RefreshCw className="w-4 h-4" /> Force Settle</>}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowGhostForm(receipt.id)}>
                            <RefreshCw className="w-4 h-4" /> Settle This Receipt
                          </Button>
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/receipt/${receipt.id}`}><ExternalLink className="w-4 h-4" /></Link>
                          </Button>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}

              {/* ═══════════════════════════════════════════════════════════
                  QUEUE 2: PENDING BANK DETAILS
                  Party added bank details. Admin triggers settlement.
              ═══════════════════════════════════════════════════════════ */}
              {pendingBankReceipts.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-orange-400" />
                    <h2 className="font-display font-semibold text-foreground">
                      Awaiting Bank Details ({pendingBankReceipts.length})
                    </h2>
                  </div>
                  {pendingBankReceipts.map((receipt) => (
                    <motion.div key={receipt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      className="bg-card rounded-2xl p-5 shadow-soft border border-orange-500/20">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-semibold text-foreground">{receipt.description}</p>
                          <p className="text-sm text-muted-foreground">{formatNaira(receipt.amount)} · {receipt.receiver_email}</p>
                        </div>
                        <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-500/10 text-orange-400">
                          <AlertCircle className="w-3 h-3" /> Bank Missing
                        </div>
                      </div>
                      <div className="bg-secondary rounded-lg p-3 mb-3 text-xs space-y-1">
                        <p className="text-muted-foreground">Missing: <span className="font-semibold text-foreground capitalize">{receipt.pending_bank_party}</span></p>
                        <p className="text-muted-foreground">Decision: <span className="font-semibold text-foreground">{receipt.settlement_decision}
                          {receipt.settlement_decision === "release_specific" && receipt.settlement_decision_amount ? ` (${formatNaira(receipt.settlement_decision_amount)})` : ""}</span>
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" asChild className="flex-1">
                          <Link to={`/receipt/${receipt.id}`}><ExternalLink className="w-4 h-4" /> View</Link>
                        </Button>
                        <Button variant="hero" size="sm" className="flex-1" disabled={forcingSettlement === receipt.id}
                          onClick={() => requirePin("Force Settle", "Retry settlement for this receipt.", () => executeForceSettle(receipt))}>
                          {forcingSettlement === receipt.id
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Settling...</>
                            : <><RefreshCw className="w-4 h-4" /> Force Settle</>}
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* ═══════════════════════════════════════════════════════════
                  QUEUE 3: UNRESOLVED DISPUTES
                  4-day window expired. Admin picks decision.
              ═══════════════════════════════════════════════════════════ */}
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
                    <p className="text-sm text-muted-foreground">No unresolved disputes.</p>
                  </motion.div>
                ) : (
                  receipts.map((receipt) => (
                    <motion.div key={receipt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      className="bg-card rounded-2xl p-5 shadow-soft border border-border">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-semibold text-foreground">{receipt.description}</p>
                          <p className="text-sm text-muted-foreground">{formatNaira(receipt.amount)} · {receipt.receiver_email}</p>
                        </div>
                        <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                          <AlertTriangle className="w-3 h-3" /> Unresolved
                        </div>
                      </div>
                      <div className="bg-secondary rounded-lg p-3 mb-3 text-xs space-y-1">
                        {receipt.sender_decision && <p className="text-muted-foreground">Sender: <span className="font-medium text-foreground">{receipt.sender_decision}</span>{receipt.sender_decision_reason && ` — "${receipt.sender_decision_reason}"`}</p>}
                        {receipt.receiver_decision && <p className="text-muted-foreground">Receiver: <span className="font-medium text-foreground">{receipt.receiver_decision}</span>{receipt.receiver_decision_reason && ` — "${receipt.receiver_decision_reason}"`}</p>}
                        {!receipt.sender_decision && !receipt.receiver_decision && <p className="italic text-muted-foreground">No decisions recorded</p>}
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
                                      ? <img src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/evidence/${e.file_path}`} alt="" className="w-full h-full object-cover" />
                                      : <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">Removed</div>}
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
                            <Button variant="hero" className="flex-1" disabled={!decision || resolving}
                              onClick={() => requirePin("Execute Decision", "This action is irreversible.", executeResolve)}>
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
          ))}

          {/* ════════════════════════════════════════════════════════════
              LOGS TAB
          ════════════════════════════════════════════════════════════ */}
          {activeTab === "logs" && (() => {
            const totalPages = Math.ceil(logsTotal / LOGS_PER_PAGE);
            const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - logsPage) <= 1)
              .reduce<(number | "…")[]>((acc, p, i, arr) => {
                if (i > 0 && (p as number) - (arr[i-1] as number) > 1) acc.push("…");
                acc.push(p); return acc;
              }, []);
            return (
              <div className="space-y-4">
                {/* Toolbar */}
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="Search messages..." value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)} className="pl-9 h-11" />
                    {logSearch && (
                      <button onClick={() => setLogSearch("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Select value={logLevel} onValueChange={setLogLevel}>
                      <SelectTrigger className="h-10 flex-1 min-w-0"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All levels</SelectItem>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="warn">Warn</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input placeholder="Context..." value={logContext}
                      onChange={(e) => setLogContext(e.target.value)} className="h-10 flex-1 min-w-0" />
                    <Button variant="outline" size="icon" className="h-10 w-10 shrink-0"
                      onClick={() => fetchLogs(logsPage)} disabled={logsLoading}>
                      <RefreshCw className={`w-4 h-4 ${logsLoading ? "animate-spin" : ""}`} />
                    </Button>
                    <Button variant="destructive" size="icon" className="h-10 w-10 shrink-0"
                      disabled={clearingLogs || logsTotal === 0}
                      onClick={() => requirePin("Clear All Logs", "Permanently deletes every log. Cannot be undone.", executeClearLogs)}>
                      {clearingLogs ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                {!logsLoading && (
                  <p className="text-xs text-muted-foreground">
                    {logsTotal === 0 ? "No logs found" : `${logsTotal} log${logsTotal !== 1 ? "s" : ""} · page ${logsPage} of ${totalPages}`}
                  </p>
                )}

                {logsLoading ? (
                  <div className="space-y-2">
                    {[1,2,3,4,5].map(i => (
                      <div key={i} className="bg-card rounded-xl p-4 animate-pulse">
                        <div className="h-3 bg-muted rounded w-1/4 mb-2" />
                        <div className="h-3 bg-muted rounded w-3/4" />
                      </div>
                    ))}
                  </div>
                ) : logs.length === 0 ? (
                  <div className="text-center py-16 space-y-3">
                    <ScrollText className="w-10 h-10 text-muted-foreground mx-auto opacity-30" />
                    <p className="text-sm text-muted-foreground">No logs match your filters</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {logs.map((log) => {
                      const isError = log.level === "error";
                      const isWarn  = log.level === "warn";
                      const border  = isError ? "border-l-destructive bg-destructive/5" : isWarn ? "border-l-warning bg-warning/5" : "border-l-primary/30";
                      const badge   = isError ? "bg-destructive/15 text-destructive" : isWarn ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary";
                      return (
                        <div key={log.id} className={`bg-card rounded-xl p-4 border border-border border-l-4 ${border}`}>
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className="text-xs font-semibold font-mono bg-secondary text-foreground px-1.5 py-0.5 rounded">{log.context}</span>
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${badge}`}>{log.level}</span>
                            <span className="text-xs text-muted-foreground ml-auto shrink-0">
                              {new Date(log.created_at).toLocaleString("en-NG", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-sm text-foreground break-words">{log.message}</p>
                          {log.metadata && (
                            <pre className="mt-2 text-xs text-muted-foreground bg-secondary rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          )}
                          {log.user_id && <p className="mt-1 text-xs text-muted-foreground font-mono">uid: {log.user_id}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <Button variant="outline" size="sm" disabled={logsPage === 1 || logsLoading}
                      onClick={() => fetchLogs(logsPage - 1)}>
                      <ChevronLeft className="w-4 h-4" /> Previous
                    </Button>
                    <div className="flex items-center gap-1">
                      {pageNumbers.map((p, i) =>
                        p === "…" ? (
                          <span key={`e${i}`} className="text-xs text-muted-foreground px-1">…</span>
                        ) : (
                          <button key={p} onClick={() => fetchLogs(p as number)}
                            className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors ${logsPage === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>
                            {p}
                          </button>
                        )
                      )}
                    </div>
                    <Button variant="outline" size="sm" disabled={logsPage >= totalPages || logsLoading}
                      onClick={() => fetchLogs(logsPage + 1)}>
                      Next <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}

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

export default Admin;