/**
 * Settings.tsx
 *
 * UX FIXES:
 * 1. Validation runs BEFORE the PIN dialog opens — user never enters PIN then
 *    gets an error. All checks happen on the Save button click.
 * 2. Fields do NOT clear on successful save — they stay populated as saved.
 *    State is updated locally after a successful DB write so no refresh needed.
 * 3. Phone number field lives inside Bank Details section (required with bank).
 *    Cannot save bank details without phone. Cannot save phone without bank.
 * 4. Bank list comes from Payscrow live API via useBanks() hook (cached).
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LogOut, CreditCard, KeyRound, Mail, Fingerprint, Loader2, Moon, Sun, AlertCircle, CheckCircle2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { motion } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import PinVerifyDialog from "@/components/PinVerifyDialog";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/supabase";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { useBanks } from "@/hooks/useBanks";
import { isValidNigerianPhone } from "@/hooks/usePhoneNumber";

const WEBAUTHN_CRED_KEY = "surer_webauthn_cred";

const bufToBase64 = (buffer: ArrayBuffer) => {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
};

const Settings = () => {
  const { user, signOut } = useAuth();
  const navigate          = useNavigate();
  const { theme, setTheme } = useTheme();
  const { banks, loading: banksLoading } = useBanks();

  const [bankCode,       setBankCode]       = useState("");
  const [accountNumber,  setAccountNumber]  = useState("");
  const [accountName,    setAccountName]    = useState("");
  const [phoneNumber,    setPhoneNumber]    = useState("");
  const [fingerprintEnabled, setFingerprintEnabled] = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);

  // PIN change
  const [showPinChange, setShowPinChange] = useState(false);
  const [currentPin,    setCurrentPin]    = useState("");
  const [newPin,        setNewPin]        = useState("");
  const [confirmNewPin, setConfirmNewPin] = useState("");
  const [changingPin,   setChangingPin]   = useState(false);

  // PIN dialog
  const [pinOpen,       setPinOpen]       = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [pinTitle,      setPinTitle]      = useState("");
  const [pinDesc,       setPinDesc]       = useState("");

  const requirePin = (title: string, desc: string, action: () => void) => {
    setPinTitle(title); setPinDesc(desc);
    setPendingAction(() => action); setPinOpen(true);
  };

  // ── Load profile (once on mount) ──────────────────────────────────────────
  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;
      const { data } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (data) {
        setBankCode(data.bank_code      || "");
        setAccountNumber(data.account_number || "");
        setAccountName(data.account_name     || "");
        setPhoneNumber(data.phone_number     || "");
        setFingerprintEnabled(data.fingerprint_enabled || false);
      }
      setLoadingProfile(false);
    };
    fetchProfile();
  }, [user]);

  // ── Derived validation state ──────────────────────────────────────────────
  const phoneRaw     = phoneNumber.replace(/\s/g, "");
  const phoneValid   = isValidNigerianPhone(phoneRaw);
  const phoneTouched = phoneNumber.length > 0;

  const bankFieldsAllEmpty =
    !bankCode && !accountNumber && !accountName && !phoneNumber;

  const bankFieldsPartiallyFilled =
    !bankFieldsAllEmpty && !(bankCode && accountNumber.length === 10 && accountName.trim() && phoneRaw && phoneValid);

  // ── Validate everything BEFORE opening PIN dialog ─────────────────────────
  // This is the key UX fix — user never enters their PIN then gets an error.
  const validateBeforeSave = (): boolean => {
    if (fingerprintEnabled && !localStorage.getItem(WEBAUTHN_CRED_KEY)) {
      toast.error("Please register your fingerprint before saving");
      return false;
    }

    // Bank section: if any field is touched, all must be complete
    if (!bankFieldsAllEmpty) {
      if (!bankCode) {
        toast.error("Please select your bank");
        return false;
      }
      if (accountNumber.length !== 10) {
        toast.error("Account number must be exactly 10 digits");
        return false;
      }
      if (!accountName.trim()) {
        toast.error("Please enter your account name");
        return false;
      }
      if (!phoneRaw) {
        toast.error("Phone number is required when saving bank details");
        return false;
      }
      if (!phoneValid) {
        toast.error("Phone must start with 070, 080, 081, 090 or 091 and be 11 digits");
        return false;
      }
    }

    return true;
  };

  // ── Execute save (called after PIN verified) ──────────────────────────────
  const executeSave = async () => {
    if (!user) return;
    setSaving(true);

    const selectedBank = banks.find((b) => b.code === bankCode);
    const { error } = await db
      .from("profiles")
      .update({
        bank_name:           selectedBank?.name || null,
        bank_code:           bankCode           || null,
        account_number:      accountNumber      || null,
        account_name:        accountName        || null,
        // Only save phone if bank details are also present
        phone_number:        bankFieldsAllEmpty ? null : phoneRaw || null,
        fingerprint_enabled: fingerprintEnabled,
      })
      .eq("id", user.id);

    setSaving(false);

    if (error) {
      toast.error("Failed to save settings. Please try again.");
      return;
    }

    // ── KEY FIX: Do NOT clear fields. Keep state as-is so user sees what saved. ──
    // The state already reflects what was saved — no need to reset or refetch.
    toast.success("Settings saved!");
  };

  // ── Handle Save button click ──────────────────────────────────────────────
  // Validate first. If valid, open PIN. If not, show error — no PIN shown.
  const handleSave = () => {
    if (!validateBeforeSave()) return; // ← Validation happens HERE, before PIN
    requirePin("Confirm Changes", "Enter your PIN to save your settings.", executeSave);
  };

  // ── PIN change ─────────────────────────────────────────────────────────────
  const handlePinChange = async () => {
    if (newPin.length !== 6 || confirmNewPin !== newPin) {
      toast.error("PINs don't match or are invalid");
      return;
    }
    setChangingPin(true);
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user!.email!, password: currentPin,
    });
    if (verifyError) {
      toast.error("Current PIN is incorrect");
      setChangingPin(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPin });
    setChangingPin(false);
    if (error) toast.error("Failed to update PIN");
    else {
      toast.success("PIN updated!");
      setShowPinChange(false);
      setCurrentPin(""); setNewPin(""); setConfirmNewPin("");
    }
  };

  const handleSignOut = async () => { await signOut(); navigate("/"); };

  // ── Fingerprint ────────────────────────────────────────────────────────────
  const handleFingerprintToggle = async (enabled: boolean) => {
    if (!user) return;
    if (enabled) {
      if (!window.PublicKeyCredential) {
        toast.error("Biometrics not supported on this device");
        return;
      }
      try {
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);
        const cred: any = await navigator.credentials.create({
          publicKey: {
            challenge,
            rp: { name: "Surer" },
            user: {
              id: new TextEncoder().encode(user.id),
              name: user.email || "",
              displayName: user.email || "",
            },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            timeout: 60000,
            authenticatorSelection: { userVerification: "required" },
            attestation: "none",
          },
        } as any);
        if (cred) {
          const rawId = bufToBase64(cred.rawId as ArrayBuffer);
          localStorage.setItem(WEBAUTHN_CRED_KEY, JSON.stringify({ id: rawId, type: cred.type }));
          setFingerprintEnabled(true);
          toast.success("Fingerprint registered. Save settings to apply.");
        }
      } catch (e) {
        console.error("WebAuthn error", e);
        toast.error("Failed to register fingerprint");
        setFingerprintEnabled(false);
      }
    } else {
      setFingerprintEnabled(false);
      localStorage.removeItem(WEBAUTHN_CRED_KEY);
      toast.success("Fingerprint authentication disabled");
    }
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

            {/* Theme */}
            <div className="flex items-center justify-between bg-card rounded-xl p-4 shadow-soft border border-border">
              <div className="flex items-center gap-3">
                {theme === "dark" ? <Moon className="w-5 h-5 text-primary" /> : <Sun className="w-5 h-5 text-primary" />}
                <div>
                  <p className="font-medium text-foreground text-sm">Dark Mode</p>
                  <p className="text-xs text-muted-foreground">Switch between light and dark</p>
                </div>
              </div>
              <Switch checked={theme === "dark"} onCheckedChange={(c) => setTheme(c ? "dark" : "light")} />
            </div>

            {/* Email */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-foreground">
                <Mail className="w-4 h-4" />
                <h2 className="font-display font-semibold">Email</h2>
              </div>
              <div className="bg-card rounded-xl p-4 shadow-soft border border-border">
                <p className="text-sm text-foreground">{user?.email}</p>
                <p className="text-xs text-muted-foreground mt-1">Email cannot be changed</p>
              </div>
            </div>

            {/* PIN */}
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
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                  className="space-y-3 bg-card rounded-xl p-4 shadow-soft border border-border">
                  <Input type="password" placeholder="Current PIN" maxLength={6} value={currentPin}
                    onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))}
                    className="h-12 text-center text-lg tracking-[0.3em] font-mono" />
                  <Input type="password" placeholder="New PIN" maxLength={6} value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                    className="h-12 text-center text-lg tracking-[0.3em] font-mono" />
                  <Input type="password" placeholder="Confirm New PIN" maxLength={6} value={confirmNewPin}
                    onChange={(e) => setConfirmNewPin(e.target.value.replace(/\D/g, ""))}
                    className="h-12 text-center text-lg tracking-[0.3em] font-mono" />
                  {confirmNewPin.length === 6 && confirmNewPin !== newPin && (
                    <p className="text-sm text-destructive text-center">PINs don't match</p>
                  )}
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1"
                      onClick={() => { setShowPinChange(false); setCurrentPin(""); setNewPin(""); setConfirmNewPin(""); }}>
                      Cancel
                    </Button>
                    <Button variant="hero" className="flex-1"
                      disabled={currentPin.length !== 6 || newPin.length !== 6 || confirmNewPin !== newPin || changingPin}
                      onClick={handlePinChange}>
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
                  <p className="text-xs text-muted-foreground">Use biometrics instead of PIN (device-specific)</p>
                </div>
              </div>
              <Switch checked={fingerprintEnabled} onCheckedChange={handleFingerprintToggle} />
            </div>

            {/* ── Bank Details + Phone ────────────────────────────────────
                Phone lives here. Required with bank details.
                Both are saved together or not at all.
            ─────────────────────────────────────────────────────────── */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-foreground">
                <CreditCard className="w-4 h-4" />
                <h2 className="font-display font-semibold">Bank Details</h2>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                Required to receive settlements. All four fields must be filled together.
              </p>

              <div className="space-y-3">
                {/* Bank */}
                {banksLoading ? (
                  <div className="h-12 bg-muted rounded-lg animate-pulse" />
                ) : (
                  <Select value={bankCode} onValueChange={setBankCode}>
                    <SelectTrigger className="h-12">
                      <SelectValue placeholder="Select your bank" />
                    </SelectTrigger>
                    <SelectContent>
                      {banks.map((bank) => (
                        <SelectItem key={bank.code} value={bank.code}>{bank.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* Account number */}
                <div>
                  <Input
                    placeholder="Account Number (10 digits)"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    maxLength={10}
                    className="h-12"
                  />
                  {accountNumber.length > 0 && accountNumber.length < 10 && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Must be exactly 10 digits
                    </p>
                  )}
                </div>

                {/* Account name */}
                <Input
                  placeholder="Account Name"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  className="h-12"
                />

                {/* Phone number — required with bank details */}
                <div>
                  <Input
                    type="tel"
                    placeholder="Phone Number (e.g. 08012345678)"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    maxLength={11}
                    className="h-12"
                  />
                  {phoneTouched && !phoneValid && phoneRaw.length > 0 && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Must start with 070, 080, 081, 090 or 091 — 11 digits total
                    </p>
                  )}
                  {phoneTouched && phoneValid && (
                    <p className="text-xs text-accent mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Valid
                    </p>
                  )}
                </div>
              </div>

              {/* Warning if partially filled */}
              {bankFieldsPartiallyFilled && (
                <div className="flex items-start gap-2 bg-warning/10 rounded-xl p-3">
                  <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    All four fields (bank, account number, account name, phone) must be filled to save.
                  </p>
                </div>
              )}
            </div>

            <Button
              variant="hero"
              size="lg"
              className="w-full"
              onClick={handleSave}
              disabled={saving || loadingProfile}
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                : "Save Settings"}
            </Button>

            <div className="pt-4 border-t border-border">
              <Button variant="outline" size="lg" className="w-full" onClick={handleSignOut}>
                <LogOut className="w-4 h-4" /> Sign Out
              </Button>
            </div>

          </motion.div>
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

export default Settings;