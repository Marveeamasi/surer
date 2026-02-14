import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, AlertTriangle, Eye, CheckCircle, ArrowRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/supabase";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatNaira } from "@/components/FeeCalculator";

const Admin = () => {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReceipt, setSelectedReceipt] = useState<any>(null);
  const [evidence, setEvidence] = useState<any[]>([]);
  const [decision, setDecision] = useState("");
  const [releaseAmount, setReleaseAmount] = useState("");
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    const checkAdmin = async () => {
      if (!user) return;
      const { data } = await db
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(!!data);
    };
    checkAdmin();
  }, [user]);

  useEffect(() => {
    const fetchUnresolved = async () => {
      // Admin sees only unresolved receipts
      const { data, error } = await db
        .from("receipts")
        .select("*")
        .eq("status", "unresolved")
        .order("created_at", { ascending: true });

      if (!error && data) {
        setReceipts(data);
      }
      setLoading(false);
    };
    fetchUnresolved();
  }, []);

  const handleViewReceipt = async (receipt: any) => {
    setSelectedReceipt(receipt);
    // Fetch evidence from disputes
    const { data: disputes } = await db
      .from("disputes")
      .select("id")
      .eq("receipt_id", receipt.id);
    
    if (disputes && disputes.length > 0) {
      const disputeIds = disputes.map((d: any) => d.id);
      const { data: evidenceData } = await db
        .from("evidence")
        .select("*")
        .in("dispute_id", disputeIds);
      setEvidence(evidenceData || []);
    } else {
      setEvidence([]);
    }
  };

  const handleResolve = async () => {
    if (!selectedReceipt || !decision) return;
    setResolving(true);

    // Admin decisions: release_all (1), release_specific (2), refund (3)
    // All execute immediately
    const updateData: any = {
      status: "completed",
      sender_decision: decision,
    };

    if (decision === "release_specific") {
      updateData.sender_decision_amount = parseFloat(releaseAmount);
    }

    await db.from("receipts").update(updateData).eq("id", selectedReceipt.id);

    // Insert admin decision record
    await db.from("admin_decisions").insert({
      dispute_id: selectedReceipt.id, // Using receipt id as reference
      decided_by: user!.id,
      decision,
      release_amount: decision === "release_specific" ? parseFloat(releaseAmount) : null,
    });

    // Resolve all disputes for this receipt
    await db.from("disputes")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("receipt_id", selectedReceipt.id);

    // Call release edge function
    try {
      await supabase.functions.invoke("payscrow-release", {
        body: {
          receiptId: selectedReceipt.id,
          decision,
          amount: decision === "release_specific" ? parseFloat(releaseAmount) : null,
        },
      });
    } catch (e) {
      console.error("Release error:", e);
    }

    // Clean up evidence from storage
    if (evidence.length > 0) {
      const paths = evidence.map((e: any) => e.file_path);
      await db.storage.from("evidence").remove(paths);
      for (const ev of evidence) {
        await db.from("evidence").delete().eq("id", ev.id);
      }
    }

    toast.success("Dispute resolved! Funds being processed.");
    setResolving(false);
    setSelectedReceipt(null);
    setDecision("");
    setReleaseAmount("");
    setReceipts((prev) => prev.filter((r) => r.id !== selectedReceipt.id));
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
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-hero flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">Admin Panel</h1>
              <p className="text-sm text-muted-foreground">Unresolved receipts needing your decision</p>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="bg-card rounded-2xl p-5 shadow-soft animate-pulse">
                  <div className="h-4 bg-muted rounded w-2/3 mb-3" />
                  <div className="h-3 bg-muted rounded w-1/3" />
                </div>
              ))}
            </div>
          ) : receipts.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16 space-y-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-accent/10 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-accent" />
              </div>
              <p className="font-display text-lg font-semibold text-foreground">All clear!</p>
              <p className="text-sm text-muted-foreground">No unresolved receipts at the moment.</p>
            </motion.div>
          ) : (
            <div className="space-y-4">
              {receipts.map((receipt) => (
                <motion.div
                  key={receipt.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-card rounded-2xl p-5 shadow-soft border border-border"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-foreground">{receipt.description}</p>
                      <p className="text-sm text-muted-foreground">{formatNaira(receipt.amount)}</p>
                    </div>
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                      <AlertTriangle className="w-3 h-3" />
                      Unresolved
                    </div>
                  </div>

                  {/* Show existing decisions */}
                  <div className="bg-secondary rounded-lg p-3 mb-3 space-y-2">
                    {receipt.sender_decision && (
                      <div>
                        <p className="text-xs text-muted-foreground">Sender: <span className="text-foreground font-medium">{receipt.sender_decision}</span></p>
                        {receipt.sender_decision_reason && <p className="text-xs text-muted-foreground italic">"{receipt.sender_decision_reason}"</p>}
                      </div>
                    )}
                    {receipt.receiver_decision && (
                      <div>
                        <p className="text-xs text-muted-foreground">Receiver: <span className="text-foreground font-medium">{receipt.receiver_decision}</span></p>
                        {receipt.receiver_decision_reason && <p className="text-xs text-muted-foreground italic">"{receipt.receiver_decision_reason}"</p>}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                    <span>Receiver: {receipt.receiver_email}</span>
                    <span>{new Date(receipt.created_at).toLocaleDateString("en-NG")}</span>
                  </div>

                  {selectedReceipt?.id === receipt.id ? (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="space-y-3 pt-3 border-t border-border">
                      {/* Evidence viewer */}
                      {evidence.length > 0 && (
                        <div>
                          <p className="text-sm font-medium text-foreground mb-2">Evidence ({evidence.length})</p>
                          <div className="grid grid-cols-3 gap-2">
                            {evidence.map((e: any, i: number) => (
                              <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                                <img
                                  src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/evidence/${e.file_path}`}
                                  alt={`Evidence ${i + 1}`}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Admin Decision: 1=Release All, 2=Release Specific, 3=Refund */}
                      <Select value={decision} onValueChange={setDecision}>
                        <SelectTrigger className="h-12">
                          <SelectValue placeholder="Choose decision..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="release_all">Release Full to Receiver</SelectItem>
                          <SelectItem value="release_specific">Release Specific Amount</SelectItem>
                          <SelectItem value="refund">Full Refund to Sender</SelectItem>
                        </SelectContent>
                      </Select>

                      {decision === "release_specific" && (
                        <Input
                          type="number"
                          placeholder="Amount to release (₦)"
                          value={releaseAmount}
                          onChange={(e) => setReleaseAmount(e.target.value)}
                          min={1000}
                          max={receipt.amount}
                          className="h-12"
                        />
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
                        <Eye className="w-4 h-4" /> Review & Decide
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/receipt/${receipt.id}`}>
                          <ArrowRight className="w-4 h-4" /> View
                        </Link>
                      </Button>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default Admin;
