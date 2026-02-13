import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogOut, CreditCard, KeyRound, Mail, Fingerprint, Loader2, Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { motion } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/supabase";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";

const Settings = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [fingerprintEnabled, setFingerprintEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);

  // PIN change
  const [showPinChange, setShowPinChange] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmNewPin, setConfirmNewPin] = useState("");
  const [changingPin, setChangingPin] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;
      const { data } = await db
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      if (data) {
        setBankName(data.bank_name || "");
        setAccountNumber(data.account_number || "");
        setAccountName(data.account_name || "");
        setFingerprintEnabled(data.fingerprint_enabled || false);
      }
      setLoadingProfile(false);
    };
    fetchProfile();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await db
      .from("profiles")
      .update({
        bank_name: bankName || null,
        account_number: accountNumber || null,
        account_name: accountName || null,
        fingerprint_enabled: fingerprintEnabled,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) toast.error("Failed to save");
    else toast.success("Settings saved!");
  };

  const handlePinChange = async () => {
    if (newPin.length !== 6 || confirmNewPin !== newPin) {
      toast.error("PINs don't match or are invalid");
      return;
    }
    setChangingPin(true);
    // Verify current PIN by signing in
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user!.email!,
      password: currentPin,
    });
    if (verifyError) {
      toast.error("Current PIN is incorrect");
      setChangingPin(false);
      return;
    }
    // Update to new PIN
    const { error } = await supabase.auth.updateUser({ password: newPin });
    setChangingPin(false);
    if (error) {
      toast.error("Failed to update PIN");
    } else {
      toast.success("PIN updated successfully!");
      setShowPinChange(false);
      setCurrentPin("");
      setNewPin("");
      setConfirmNewPin("");
    }
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

            {/* Theme toggle */}
            <div className="flex items-center justify-between bg-card rounded-xl p-4 shadow-soft border border-border">
              <div className="flex items-center gap-3">
                {theme === "dark" ? <Moon className="w-5 h-5 text-primary" /> : <Sun className="w-5 h-5 text-primary" />}
                <div>
                  <p className="font-medium text-foreground text-sm">Dark Mode</p>
                  <p className="text-xs text-muted-foreground">Switch between light and dark theme</p>
                </div>
              </div>
              <Switch
                checked={theme === "dark"}
                onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
              />
            </div>

            {/* Email */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-foreground">
                <Mail className="w-4 h-4" />
                <h2 className="font-display font-semibold">Email</h2>
              </div>
              <div className="bg-card rounded-xl p-4 shadow-soft border border-border">
                <p className="text-sm text-foreground">{user?.email}</p>
                <p className="text-xs text-muted-foreground mt-1">Email cannot be changed for security</p>
              </div>
            </div>

            {/* PIN management */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-foreground">
                <KeyRound className="w-4 h-4" />
                <h2 className="font-display font-semibold">Security PIN</h2>
              </div>

              {!showPinChange ? (
                <Button variant="outline" className="w-full" onClick={() => setShowPinChange(true)}>
                  <KeyRound className="w-4 h-4" /> Change PIN
                </Button>
              ) : (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  className="space-y-3 bg-card rounded-xl p-4 shadow-soft border border-border"
                >
                  <Input
                    type="password"
                    placeholder="Current PIN"
                    maxLength={6}
                    value={currentPin}
                    onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))}
                    className="h-12 text-center text-lg tracking-[0.3em] font-mono"
                  />
                  <Input
                    type="password"
                    placeholder="New PIN"
                    maxLength={6}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                    className="h-12 text-center text-lg tracking-[0.3em] font-mono"
                  />
                  <Input
                    type="password"
                    placeholder="Confirm New PIN"
                    maxLength={6}
                    value={confirmNewPin}
                    onChange={(e) => setConfirmNewPin(e.target.value.replace(/\D/g, ""))}
                    className="h-12 text-center text-lg tracking-[0.3em] font-mono"
                  />
                  {confirmNewPin.length === 6 && confirmNewPin !== newPin && (
                    <p className="text-sm text-destructive text-center">PINs don't match</p>
                  )}
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => { setShowPinChange(false); setCurrentPin(""); setNewPin(""); setConfirmNewPin(""); }}>
                      Cancel
                    </Button>
                    <Button
                      variant="hero"
                      className="flex-1"
                      disabled={currentPin.length !== 6 || newPin.length !== 6 || confirmNewPin !== newPin || changingPin}
                      onClick={handlePinChange}
                    >
                      {changingPin ? <><Loader2 className="w-4 h-4 animate-spin" /> Updating...</> : "Update PIN"}
                    </Button>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Fingerprint */}
            <div className="flex items-center justify-between bg-card rounded-xl p-4 shadow-soft border border-border">
              <div className="flex items-center gap-3">
                <Fingerprint className="w-5 h-5 text-primary" />
                <div>
                  <p className="font-medium text-foreground text-sm">Fingerprint Login</p>
                  <p className="text-xs text-muted-foreground">Use biometrics instead of PIN (mobile only)</p>
                </div>
              </div>
              <Switch checked={fingerprintEnabled} onCheckedChange={setFingerprintEnabled} />
            </div>

            {/* Bank details */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-foreground">
                <CreditCard className="w-4 h-4" />
                <h2 className="font-display font-semibold">Bank Details (for withdrawals)</h2>
              </div>
              <div className="space-y-3">
                <Input placeholder="Bank Name" value={bankName} onChange={(e) => setBankName(e.target.value)} className="h-12" />
                <Input
                  placeholder="Account Number"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                  maxLength={10}
                  className="h-12"
                />
                <Input placeholder="Account Name" value={accountName} onChange={(e) => setAccountName(e.target.value)} className="h-12" />
              </div>
            </div>

            <Button variant="hero" size="lg" className="w-full" onClick={handleSave} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : "Save Settings"}
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
