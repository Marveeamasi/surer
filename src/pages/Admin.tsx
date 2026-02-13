import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, AlertTriangle, Eye, CheckCircle, ArrowRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/supabase";
import { toast } from "sonner";

const formatNaira = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(amount);

const Admin = () => {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDispute, setSelectedDispute] = useState<any>(null);
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
    const fetchDisputes = async () => {
      // Get unresolved disputes (open or escalated) with receipt info
      const { data, error } = await db
        .from("disputes")
        .select("*, receipts(*)")
        .in("status", ["open", "escalated", "pending_response"])
        .order("created_at", { ascending: true });

      if (!error && data) {
        setDisputes(data);
      }
      setLoading(false);
    };
    fetchDisputes();
  }, []);

  const handleViewDispute = async (dispute: any) => {
    setSelectedDispute(dispute);
    // Fetch evidence
    const { data } = await db
      .from("evidence")
      .select("*")
      .eq("dispute_id", dispute.id);
    setEvidence(data || []);
  };

  const handleResolve = async () => {
    if (!selectedDispute || !decision) return;
    setResolving(true);

    const receipt = selectedDispute.receipts;

    // Insert admin decision
    const { error: decError } = await db.from("admin_decisions").insert({
      dispute_id: selectedDispute.id,
      decided_by: user!.id,
      decision,
      release_amount: decision === "release_specific" ? parseFloat(releaseAmount) : null,
    });

    if (decError) {
      toast.error("Failed to save decision");
      setResolving(false);
      return;
    }

    // Update dispute status
    await db.from("disputes").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", selectedDispute.id);

    // Update receipt
    await db.from("receipts").update({ status: "completed" }).eq("id", receipt.id);

    // Delete evidence files
    if (evidence.length > 0) {
      const paths = evidence.map((e: any) => e.file_path);
      await db.storage.from("evidence").remove(paths);
      await db.from("evidence").delete().eq("dispute_id", selectedDispute.id);
    }

    toast.success("Dispute resolved!");
    setResolving(false);
    setSelectedDispute(null);
    setDecision("");
    setReleaseAmount("");
    // Refresh
    setDisputes((prev) => prev.filter((d) => d.id !== selectedDispute.id));
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
              <p className="text-sm text-muted-foreground">Unresolved disputes needing your attention</p>
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
          ) : disputes.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16 space-y-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-accent/10 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-accent" />
              </div>
              <p className="font-display text-lg font-semibold text-foreground">All clear!</p>
              <p className="text-sm text-muted-foreground">No unresolved disputes at the moment.</p>
            </motion.div>
          ) : (
            <div className="space-y-4">
              {disputes.map((dispute) => {
                const receipt = dispute.receipts;
                return (
                  <motion.div
                    key={dispute.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card rounded-2xl p-5 shadow-soft border border-border"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-semibold text-foreground">{receipt?.description || "Receipt"}</p>
                        <p className="text-sm text-muted-foreground">{formatNaira(receipt?.amount || 0)}</p>
                      </div>
                      <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                        <AlertTriangle className="w-3 h-3" />
                        {dispute.status}
                      </div>
                    </div>

                    <div className="bg-secondary rounded-lg p-3 mb-3">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Reason</p>
                      <p className="text-sm text-foreground">{dispute.reason}</p>
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                      <span>Proposed: {dispute.proposed_action}</span>
                      <span>{new Date(dispute.created_at).toLocaleDateString("en-NG")}</span>
                    </div>

                    {selectedDispute?.id === dispute.id ? (
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
                                  <span className="absolute bottom-1 left-1 bg-foreground/70 text-background text-[10px] px-1.5 py-0.5 rounded-full">
                                    {e.type}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Decision */}
                        <Select value={decision} onValueChange={setDecision}>
                          <SelectTrigger className="h-12">
                            <SelectValue placeholder="Choose decision..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="release_full">Release Full to Receiver</SelectItem>
                            <SelectItem value="release_specific">Release Specific Amount</SelectItem>
                            <SelectItem value="refund_full">Full Refund to Sender</SelectItem>
                          </SelectContent>
                        </Select>

                        {decision === "release_specific" && (
                          <Input
                            type="number"
                            placeholder="Amount to release (₦)"
                            value={releaseAmount}
                            onChange={(e) => setReleaseAmount(e.target.value)}
                            min={1000}
                            max={receipt?.amount}
                            className="h-12"
                          />
                        )}

                        <div className="flex gap-3">
                          <Button variant="outline" className="flex-1" onClick={() => setSelectedDispute(null)}>Cancel</Button>
                          <Button variant="hero" className="flex-1" onClick={handleResolve} disabled={!decision || resolving}>
                            {resolving ? <><Loader2 className="w-4 h-4 animate-spin" /> Resolving...</> : "Resolve"}
                          </Button>
                        </div>
                      </motion.div>
                    ) : (
                      <Button variant="outline" size="sm" className="w-full" onClick={() => handleViewDispute(dispute)}>
                        <Eye className="w-4 h-4" /> Review & Decide
                      </Button>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default Admin;
