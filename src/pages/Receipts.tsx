import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import { motion } from "framer-motion";

const Receipts = () => {
  return (
    <AppLayout showBottomNav>
      <div className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-2xl">
          <h1 className="font-display text-2xl font-bold text-foreground mb-2">All Receipts</h1>
          <p className="text-sm text-muted-foreground mb-8">View and search all your transactions</p>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16 space-y-4"
          >
            <div className="w-16 h-16 mx-auto rounded-2xl bg-secondary flex items-center justify-center">
              <FileText className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">This page will show a searchable list of all receipts.</p>
            <Button variant="secondary" asChild>
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Receipts;
