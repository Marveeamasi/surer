import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Plus, FileText, Clock, CheckCircle, AlertTriangle, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import Navbar from "@/components/Navbar";

const statusConfig = {
  pending: { label: "Pending", icon: Clock, className: "bg-warning/10 text-warning" },
  active: { label: "Active", icon: FileText, className: "bg-primary/10 text-primary" },
  dispute: { label: "In Dispute", icon: AlertTriangle, className: "bg-destructive/10 text-destructive" },
  completed: { label: "Completed", icon: CheckCircle, className: "bg-accent/10 text-accent" },
};

// Mock data for UI demo
const mockReceipts = [
  { id: "1", description: "Logo design for startup", amount: 50000, status: "active" as const, role: "sender", other: "designer@email.com", date: "Feb 10, 2026" },
  { id: "2", description: "Phone purchase - iPhone 15", amount: 850000, status: "pending" as const, role: "receiver", other: "buyer@email.com", date: "Feb 9, 2026" },
  { id: "3", description: "Freelance writing gig", amount: 25000, status: "completed" as const, role: "receiver", other: "client@email.com", date: "Feb 5, 2026" },
];

const formatNaira = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(amount);

const Dashboard = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-2xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">Your Receipts</h1>
              <p className="text-sm text-muted-foreground">Manage your secure payments</p>
            </div>
            <Button variant="hero" asChild>
              <Link to="/create">
                <Plus className="w-4 h-4" /> New Receipt
              </Link>
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            {[
              { label: "Active", value: "1", color: "text-primary" },
              { label: "Pending", value: "1", color: "text-warning" },
              { label: "Completed", value: "1", color: "text-accent" },
            ].map((s) => (
              <div key={s.label} className="bg-card rounded-xl p-4 shadow-soft text-center">
                <p className={`font-display text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Receipt list */}
          <div className="space-y-3">
            {mockReceipts.map((receipt, i) => {
              const config = statusConfig[receipt.status];
              return (
                <motion.div
                  key={receipt.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Link
                    to={`/receipt/${receipt.id}`}
                    className="block bg-card rounded-2xl p-5 shadow-soft hover:shadow-card transition-shadow border border-border"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground truncate">{receipt.description}</p>
                        <p className="text-sm text-muted-foreground">
                          {receipt.role === "sender" ? "To" : "From"}: {receipt.other}
                        </p>
                      </div>
                      <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${config.className}`}>
                        <config.icon className="w-3 h-3" />
                        {config.label}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="font-display text-lg font-bold text-foreground">{formatNaira(receipt.amount)}</p>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        {receipt.date} <ArrowRight className="w-3 h-3" />
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
