import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Search, Clock, CheckCircle, AlertTriangle, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { db } from "@/lib/supabase";

const statusConfig: Record<string, { label: string; icon: any; className: string }> = {
  pending: { label: "Pending", icon: Clock, className: "bg-warning/10 text-warning" },
  active: { label: "Active", icon: FileText, className: "bg-primary/10 text-primary" },
  dispute: { label: "In Dispute", icon: AlertTriangle, className: "bg-destructive/10 text-destructive" },
  unresolved: { label: "Unresolved", icon: AlertTriangle, className: "bg-destructive/10 text-destructive" },
  completed: { label: "Completed", icon: CheckCircle, className: "bg-accent/10 text-accent" },
};

const formatNaira = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(amount);

const Receipts = () => {
  const { user } = useAuth();
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    const fetchReceipts = async () => {
      const { data } = await db
        .from("receipts")
        .select("*")
        .order("created_at", { ascending: false });
      setReceipts(data || []);
      setLoading(false);
    };
    fetchReceipts();
  }, []);

  const filtered = receipts.filter((r) => {
    const matchesSearch = !search || 
      r.description?.toLowerCase().includes(search.toLowerCase()) ||
      r.receiver_email?.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || r.status === filter;
    return matchesSearch && matchesFilter;
  });

  const filters = ["all", "pending", "active", "dispute", "completed"];

  return (
    <AppLayout showBottomNav>
      <div className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-2xl">
          <h1 className="font-display text-2xl font-bold text-foreground mb-2">All Receipts</h1>
          <p className="text-sm text-muted-foreground mb-6">View and search all your transactions</p>

          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search receipts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-12 pl-10"
            />
          </div>

          {/* Filters */}
          <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
            {filters.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-card rounded-2xl p-5 shadow-soft animate-pulse">
                  <div className="h-4 bg-muted rounded w-2/3 mb-3" />
                  <div className="h-3 bg-muted rounded w-1/3" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16 space-y-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-secondary flex items-center justify-center">
                <FileText className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">
                {search ? "No receipts match your search" : "No receipts yet"}
              </p>
            </motion.div>
          ) : (
            <div className="space-y-3">
              {filtered.map((receipt, i) => {
                const config = statusConfig[receipt.status] || statusConfig.pending;
                const StatusIcon = config.icon;
                return (
                  <motion.div
                    key={receipt.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
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

export default Receipts;
