import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Plus, Clock, CheckCircle, AlertTriangle, ArrowRight, LogOut, FileText } from "lucide-react";
import { motion } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/supabase";
import { toast } from "sonner";

const statusConfig: Record<string, { label: string; icon: any; className: string }> = {
  pending: { label: "Pending", icon: Clock, className: "bg-warning/10 text-warning" },
  active: { label: "Active", icon: FileText, className: "bg-primary/10 text-primary" },
  dispute: { label: "In Dispute", icon: AlertTriangle, className: "bg-destructive/10 text-destructive" },
  unresolved: { label: "Unresolved", icon: AlertTriangle, className: "bg-destructive/10 text-destructive" },
  completed: { label: "Completed", icon: CheckCircle, className: "bg-accent/10 text-accent" },
};

const formatNaira = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(amount);

interface Receipt {
  id: string;
  description: string;
  amount: number;
  status: string;
  sender_id: string;
  receiver_id: string | null;
  receiver_email: string;
  created_at: string;
}

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReceipts = async () => {
      const { data, error } = await db
        .from("receipts")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        toast.error("Failed to load receipts");
      } else {
        setReceipts((data as any) || []);
      }
      setLoading(false);
    };

    fetchReceipts();
  }, []);

  const statusCounts = receipts.reduce(
    (acc, r) => {
      if (r.status === "active") acc.active++;
      else if (r.status === "pending") acc.pending++;
      else if (r.status === "completed") acc.completed++;
      else if (r.status === "dispute" || r.status === "unresolved") acc.disputes++;
      return acc;
    },
    { active: 0, pending: 0, completed: 0, disputes: 0 }
  );

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <AppLayout showBottomNav>
      <div className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-2xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">Your Receipts</h1>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="hero" size="sm" asChild>
                <Link to="/create"><Plus className="w-4 h-4" /> New</Link>
              </Button>
              <Button variant="ghost" size="icon" onClick={handleSignOut}>
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-2 mb-8">
            {[
              { label: "Active", value: statusCounts.active, color: "text-primary" },
              { label: "Pending", value: statusCounts.pending, color: "text-warning" },
              { label: "Disputes", value: statusCounts.disputes, color: "text-destructive" },
              { label: "Done", value: statusCounts.completed, color: "text-accent" },
            ].map((s) => (
              <div key={s.label} className="bg-card rounded-xl p-3 shadow-soft text-center">
                <p className={`font-display text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Receipt list */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-card rounded-2xl p-5 shadow-soft animate-pulse">
                  <div className="h-4 bg-muted rounded w-2/3 mb-3" />
                  <div className="h-3 bg-muted rounded w-1/3" />
                </div>
              ))}
            </div>
          ) : receipts.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16 space-y-4"
            >
              <div className="w-16 h-16 mx-auto rounded-2xl bg-secondary flex items-center justify-center">
                <FileText className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">No receipts yet</p>
              <Button variant="hero" asChild>
                <Link to="/create">Create your first receipt</Link>
              </Button>
            </motion.div>
          ) : (
            <div className="space-y-3">
              {receipts.map((receipt, i) => {
                const config = statusConfig[receipt.status] || statusConfig.pending;
                const StatusIcon = config.icon;
                return (
                  <motion.div
                    key={receipt.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Link
                      to={`/receipt/${receipt.id}`}
                      className="block bg-card rounded-2xl p-5 shadow-soft hover:shadow-card transition-all border border-border active:scale-[0.98]"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-foreground truncate">{receipt.description}</p>
                          <p className="text-sm text-muted-foreground">
                            {receipt.sender_id === user?.id ? "To" : "From"}: {receipt.receiver_email}
                          </p>
                        </div>
                        <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${config.className}`}>
                          <StatusIcon className="w-3 h-3" />
                          {config.label}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="font-display text-lg font-bold text-foreground">{formatNaira(receipt.amount)}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          {new Date(receipt.created_at).toLocaleDateString("en-NG", { month: "short", day: "numeric" })}
                          <ArrowRight className="w-3 h-3" />
                        </div>
                      </div>
                    </Link>
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

export default Dashboard;
