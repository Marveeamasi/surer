/**
 * Settings.tsx
 *
 * FIXES IN THIS VERSION:
 *
 * 1. FINGERPRINT IS FULLY INDEPENDENT
 *    - Toggling fingerprint on/off saves to DB immediately — no need to click "Save Settings"
 *    - handleSave / executeSave no longer touch fingerprint_enabled at all
 *    - validateBeforeSave no longer checks fingerprint state
 *
 * 2. FINGERPRINT IS MOBILE-ONLY
 *    - Detected via useIsMobile() hook + window.PublicKeyCredential platform check
 *    - On desktop: switch is disabled, shows "Available on mobile only" message
 *    - No confusing passkey device picker on desktop
 *
 * 3. FINGERPRINT GOES STRAIGHT TO DEVICE BIOMETRICS
 *    - authenticatorAttachment: "platform" forces the device's own sensor
 *      (fingerprint scanner / Face ID) — skips the "choose a device" picker entirely
 *    - On Android: fingerprint/face unlock pops up immediately
 *    - On iPhone: Face ID / Touch ID pops up immediately
 *
 * 4. FIELDS PERSIST AFTER SAVE
 *    - State is already correct after save — no refetch needed, no flicker
 *    - fingerprintEnabled state stays accurate because it's managed independently
 *
 * 5. SAVE BUTTON ONLY HANDLES BANK + PHONE
 *    - Fingerprint has its own save path
 *    - Theme has its own instant save (already worked)
 *    - PIN has its own save path (already worked)
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown, Check } from "lucide-react";
import {
  LogOut, CreditCard, KeyRound, Mail, Fingerprint,
  Loader2, Moon, Sun, AlertCircle, CheckCircle2, Smartphone,
} from "lucide-react";
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
import { useIsMobile } from "@/hooks/use-mobile";

const WEBAUTHN_CRED_KEY = "surer_webauthn_cred";

const bufToBase64 = (buffer: ArrayBuffer): string => {
  let binary = "";
  new Uint8Array(buffer).forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
};

const Settings = () => {
  const { user, signOut } = useAuth();
  const navigate           = useNavigate();
  const { theme, setTheme } = useTheme();
  const { banks, loading: banksLoading } = useBanks();
  const isMobile = useIsMobile();

  // Bank + phone fields
  const [bankCode,      setBankCode]      = useState("");
  const [bankOpen,      setBankOpen]      = useState(false); // combobox open state
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName,   setAccountName]   = useState("");
  const [phoneNumber,   setPhoneNumber]   = useState("");
  const [saving,        setSaving]        = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);

  // Fingerprint — managed independently from bank save
  const [fingerprintEnabled,  setFingerprintEnabled]  = useState(false);
  const [savingFingerprint,   setSavingFingerprint]   = useState(false);

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

  // ── Load profile ──────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;
      const { data } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (data) {
        setBankCode(data.bank_code       || "");
        setAccountNumber(data.account_number || "");
        setAccountName(data.account_name     || "");
        setPhoneNumber(data.phone_number     || "");
        // Fingerprint: DB value AND localStorage credential must both be present
        const hasCred = !!localStorage.getItem(WEBAUTHN_CRED_KEY);
        setFingerprintEnabled((data.fingerprint_enabled || false) && hasCred);
      }
      setLoadingProfile(false);
    };
    fetchProfile();
  }, [user]);

  // ── Derived validation ────────────────────────────────────────────────────
  const phoneRaw    = phoneNumber.replace(/\s/g, "");
  const phoneValid  = isValidNigerianPhone(phoneRaw);
  const phoneTouched = phoneNumber.length > 0;

  const bankFieldsAllEmpty =
    !bankCode && !accountNumber && !accountName && !phoneNumber;

  const bankFieldsPartiallyFilled =
    !bankFieldsAllEmpty &&
    !(bankCode && accountNumber.length === 10 && accountName.trim() && phoneRaw && phoneValid);

  // ── Validate bank fields BEFORE opening PIN ───────────────────────────────
  const validateBeforeSave = (): boolean => {
    if (!bankFieldsAllEmpty) {
      if (!bankCode) { toast.error("Please select your bank"); return false; }
      if (accountNumber.length !== 10) { toast.error("Account number must be exactly 10 digits"); return false; }
      if (!accountName.trim()) { toast.error("Please enter your account name"); return false; }
      if (!phoneRaw) { toast.error("Phone number is required with bank details"); return false; }
      if (!phoneValid) { toast.error("Phone must start with 070, 080, 081, 090 or 091 and be 11 digits"); return false; }
    }
    return true;
  };

  // ── Save bank + phone ONLY (fingerprint is NOT included here) ─────────────
  const executeSave = async () => {
    if (!user) return;
    setSaving(true);
    const selectedBank = banks.find((b) => b.code === bankCode);
    const { error } = await db.from("profiles").update({
      bank_name:      selectedBank?.name || null,
      bank_code:      bankCode           || null,
      account_number: accountNumber      || null,
      account_name:   accountName        || null,
      phone_number:   bankFieldsAllEmpty ? null : phoneRaw || null,
      // fingerprint_enabled is NOT saved here — it has its own independent path
    }).eq("id", user.id);
    setSaving(false);
    if (error) { toast.error("Failed to save. Please try again."); return; }
    toast.success("Bank details saved!");
  };

  const handleSave = () => {
    if (!validateBeforeSave()) return;
    requirePin("Confirm Changes", "Enter your PIN to save your bank details.", executeSave);
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
    if (verifyError) { toast.error("Current PIN is incorrect"); setChangingPin(false); return; }
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

  // ── Fingerprint toggle — saves to DB immediately, fully independent ────────
  //
  // KEY CHANGES:
  // 1. authenticatorAttachment: "platform" → goes straight to device biometrics
  //    (fingerprint sensor / Face ID). No "choose a device" picker.
  // 2. Saves fingerprint_enabled to DB immediately after credential created.
  //    No need to click "Save Settings".
  // 3. Disabling also saves to DB immediately.
  // 4. Only available on mobile (isMobile check + platform authenticator).
  const handleFingerprintToggle = async (enabled: boolean) => {
    if (!user) return;

    // Guard: mobile only
    if (!isMobile) {
      toast.error("Fingerprint login is only available on mobile devices.");
      return;
    }

    if (enabled) {
      // Check platform biometric support
      if (!window.PublicKeyCredential) {
        toast.error("Biometrics not supported on this device");
        return;
      }

      setSavingFingerprint(true);
      try {
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);

        // authenticatorAttachment: "platform" is the key setting.
        // This tells the browser to use ONLY the device's built-in authenticator
        // (fingerprint sensor, Face ID, Windows Hello) — never an external key or
        // cross-device picker. The device's native biometric UI appears immediately.
        const cred: any = await navigator.credentials.create({
          publicKey: {
            challenge,
            rp: { name: "Surer", id: window.location.hostname },
            user: {
              id:          new TextEncoder().encode(user.id),
              name:        user.email || "",
              displayName: user.email || "",
            },
            pubKeyCredParams: [
              { type: "public-key", alg: -7  }, // ES256
              { type: "public-key", alg: -257 }, // RS256 (wider device support)
            ],
            timeout: 60000,
            authenticatorSelection: {
              authenticatorAttachment: "platform", // ← device biometrics only, no picker
              userVerification:        "required", // ← must verify with biometric
              requireResidentKey:      false,
            },
            attestation: "none",
          },
        } as any);

        if (cred) {
          // Save credential to localStorage (device-specific)
          const rawId = bufToBase64(cred.rawId as ArrayBuffer);
          localStorage.setItem(WEBAUTHN_CRED_KEY, JSON.stringify({ id: rawId, type: cred.type }));

          // ── Save to DB immediately — no need to click "Save Settings" ────
          const { error } = await db.from("profiles")
            .update({ fingerprint_enabled: true })
            .eq("id", user.id);

          if (error) {
            toast.error("Fingerprint registered but failed to save. Please try again.");
            localStorage.removeItem(WEBAUTHN_CRED_KEY);
            setSavingFingerprint(false);
            return;
          }

          setFingerprintEnabled(true);
          toast.success("✅ Fingerprint login enabled!");
        }
      } catch (e: any) {
        // User cancelled the biometric prompt or device doesn't support it
        if (e?.name === "NotAllowedError") {
          toast.error("Fingerprint registration was cancelled.");
        } else if (e?.name === "NotSupportedError") {
          toast.error("This device doesn't support biometric authentication.");
        } else {
          console.error("WebAuthn error:", e);
          toast.error("Failed to register fingerprint. Please try again.");
        }
        setFingerprintEnabled(false);
      }
      setSavingFingerprint(false);

    } else {
      // ── Disable fingerprint — save to DB immediately ──────────────────
      setSavingFingerprint(true);
      try {
        const { error } = await db.from("profiles")
          .update({ fingerprint_enabled: false })
          .eq("id", user.id);

        if (error) {
          toast.error("Failed to disable fingerprint. Please try again.");
          setSavingFingerprint(false);
          return;
        }

        // Clear local credential
        localStorage.removeItem(WEBAUTHN_CRED_KEY);
        setFingerprintEnabled(false);
        toast.success("Fingerprint login disabled.");
      } catch {
        toast.error("Failed to disable fingerprint. Please try again.");
      }
      setSavingFingerprint(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <AppLayout showBottomNav>
      <div className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-lg">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">

            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>

            {/* ── Theme ───────────────────────────────────────────────── */}
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

            {/* ── Email ───────────────────────────────────────────────── */}
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

            {/* ── PIN ─────────────────────────────────────────────────── */}
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

            {/* ── Fingerprint — mobile only, saves immediately ─────────── */}
            <div className={`flex items-center justify-between bg-card rounded-xl p-4 shadow-soft border border-border ${!isMobile ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-3">
                <Fingerprint className={`w-5 h-5 ${isMobile ? "text-primary" : "text-muted-foreground"}`} />
                <div>
                  <p className="font-medium text-foreground text-sm">Fingerprint Login</p>
                  {isMobile ? (
                    <p className="text-xs text-muted-foreground">
                      {savingFingerprint
                        ? "Saving..."
                        : fingerprintEnabled
                          ? "Enabled — tap to disable"
                          : "Tap to enable biometric login"}
                    </p>
                  ) : (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Smartphone className="w-3 h-3 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">Available on mobile only</p>
                    </div>
                  )}
                </div>
              </div>
              {savingFingerprint ? (
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              ) : (
                <Switch
                  checked={fingerprintEnabled}
                  onCheckedChange={handleFingerprintToggle}
                  disabled={!isMobile || savingFingerprint}
                />
              )}
            </div>

            {/* ── Bank Details + Phone ─────────────────────────────────── */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-foreground">
                <CreditCard className="w-4 h-4" />
                <h2 className="font-display font-semibold">Bank Details</h2>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                Required to receive settlements. All four fields must be filled together.
              </p>

              <div className="space-y-3">
                {/* Bank select — searchable combobox */}
                {banksLoading ? (
                  <div className="h-12 bg-muted rounded-lg animate-pulse" />
                ) : (
                  <Popover open={bankOpen} onOpenChange={setBankOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={bankOpen}
                        className="w-full h-12 justify-between font-normal text-sm"
                      >
                        <span className={bankCode ? "text-foreground" : "text-muted-foreground"}>
                          {bankCode
                            ? banks.find((b) => b.code === bankCode)?.name
                            : "Select your bank"}
                        </span>
                        <ChevronsUpDown className="w-4 h-4 shrink-0 text-muted-foreground ml-2" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="p-0 w-[--radix-popover-trigger-width]"
                      align="start"
                      side="bottom"
                      sideOffset={4}
                    >
                      <Command>
                        {/* Built-in fuzzy search — filters as you type */}
                        <CommandInput placeholder="Search bank..." className="h-11" />
                        <CommandList className="max-h-60">
                          <CommandEmpty>No bank found.</CommandEmpty>
                          <CommandGroup>
                            {banks.map((bank) => (
                              <CommandItem
                                key={bank.code}
                                value={bank.name} // cmdk searches on this value
                                onSelect={() => {
                                  setBankCode(bank.code);
                                  setBankOpen(false);
                                }}
                                className="cursor-pointer"
                              >
                                <Check
                                  className={`w-4 h-4 mr-2 shrink-0 ${
                                    bankCode === bank.code ? "opacity-100 text-primary" : "opacity-0"
                                  }`}
                                />
                                {bank.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
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

                {/* Phone number */}
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

              {/* Partial fill warning */}
              {bankFieldsPartiallyFilled && (
                <div className="flex items-start gap-2 bg-warning/10 rounded-xl p-3">
                  <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    All four fields (bank, account number, account name, phone) must be filled to save.
                  </p>
                </div>
              )}
            </div>

            {/* ── Save button — bank + phone only ─────────────────────── */}
            <Button
              variant="hero"
              size="lg"
              className="w-full"
              onClick={handleSave}
              disabled={saving || loadingProfile}
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                : "Save Bank Details"}
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