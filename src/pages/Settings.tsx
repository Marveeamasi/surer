import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogOut, User, CreditCard, Shield } from "lucide-react";
import { motion } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/supabase";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const Settings = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await db
      .from("profiles")
      .update({
        display_name: displayName || null,
        bank_name: bankName || null,
        account_number: accountNumber || null,
        account_name: accountName || null,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) toast.error("Failed to save");
    else toast.success("Settings saved!");
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <AppLayout showBottomNav>
      <div className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-lg">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>

            {/* Profile section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-foreground">
                <User className="w-4 h-4" />
                <h2 className="font-display font-semibold">Profile</h2>
              </div>
              <div className="space-y-3">
                <Input
                  placeholder="Display Name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="h-12"
                />
              </div>
            </div>

            {/* Bank details */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-foreground">
                <CreditCard className="w-4 h-4" />
                <h2 className="font-display font-semibold">Bank Details (for withdrawals)</h2>
              </div>
              <div className="space-y-3">
                <Input placeholder="Bank Name" value={bankName} onChange={(e) => setBankName(e.target.value)} className="h-12" />
                <Input placeholder="Account Number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="h-12" />
                <Input placeholder="Account Name" value={accountName} onChange={(e) => setAccountName(e.target.value)} className="h-12" />
              </div>
            </div>

            <Button variant="hero" size="lg" className="w-full" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Settings"}
            </Button>

            <div className="pt-4 border-t border-border">
              <Button variant="outline" size="lg" className="w-full" onClick={handleSignOut}>
                <LogOut className="w-4 h-4" /> Sign Out
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Settings;
