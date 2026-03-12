import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Fingerprint, Loader2, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const WEBAUTHN_CRED_KEY = "surer_webauthn_cred";

const base64ToBuf = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const len = binary.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = binary.charCodeAt(i);
  return buf;
};

interface PinVerifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: () => void;
  title?: string;
  description?: string;
}

const PinVerifyDialog = ({
  open,
  onOpenChange,
  onVerified,
  title = "Verify your identity",
  description = "Enter your 6-digit PIN to confirm this action.",
}: PinVerifyDialogProps) => {
  const { user } = useAuth();
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [hasCredential, setHasCredential] = useState(false);

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6 || !user?.email) return;
    setVerifying(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: pin,
      });

      if (error) {
        toast.error("Invalid PIN. Please try again.");
        setPin("");
      } else {
        setPin("");
        onOpenChange(false);
        onVerified();
      }
    } catch {
      toast.error("Verification failed");
      setPin("");
    }
    setVerifying(false);
  };

  const handleBiometric = async () => {
    if (!window.PublicKeyCredential) {
      toast.error("Biometrics not supported on this device");
      return;
    }

    try {
      setVerifying(true);

      const raw = localStorage.getItem(WEBAUTHN_CRED_KEY);
      if (!raw) {
        toast.error("No biometric credential registered on this device");
        setVerifying(false);
        return;
      }

      const credObj = JSON.parse(raw);
      const allow = [
        {
          id: base64ToBuf(credObj.id) as unknown as BufferSource,
          type: credObj.type,
        },
      ];

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: new Uint8Array(32),
          timeout: 60000,
          userVerification: "required",
          rpId: window.location.hostname,
          allowCredentials: allow,
        },
      });

      if (assertion) {
        onOpenChange(false);
        onVerified();
      }
    } catch (err) {
      console.error("Biometric verify error", err);
      toast.error("Biometric verification failed or cancelled");
    }
    setVerifying(false);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setPin("");
      setShowPin(false);
    }
    onOpenChange(isOpen);
  };

  // Check if biometric credential exists (localStorage + DB flag)
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("fingerprint_enabled")
          .eq("id", user.id)
          .single();
        const localCred = localStorage.getItem(WEBAUTHN_CRED_KEY);
        if (data?.fingerprint_enabled && localCred) setHasCredential(true);
      } catch {}
    })();
  }, [user]);

  // If dialog opens and we have a stored credential, prompt immediately
  useEffect(() => {
    if (open && hasCredential) {
      handleBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasCredential]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm mx-auto">
        <DialogHeader className="text-center">
          <div className="w-12 h-12 mx-auto rounded-xl bg-primary/10 flex items-center justify-center mb-2">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <DialogTitle className="font-display text-lg">{title}</DialogTitle>
          <DialogDescription className="text-sm">{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleVerifyPin} className="space-y-4 mt-2">
          <div className="relative">
            <Input
              type={showPin ? "text" : "password"}
              placeholder="••••••"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              required
              autoFocus
              className="h-14 text-center text-2xl tracking-[0.5em] font-mono"
            />
            <button
              type="button"
              onClick={() => setShowPin(!showPin)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>

          <Button
            type="submit"
            variant="hero"
            size="lg"
            className="w-full"
            disabled={pin.length !== 6 || verifying}
          >
            {verifying ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</>
            ) : (
              "Confirm"
            )}
          </Button>
        </form>

        {hasCredential && (
          <button
            type="button"
            onClick={handleBiometric}
            disabled={verifying}
            className="flex items-center justify-center gap-2 w-full py-3 text-sm text-primary hover:text-primary/80 transition-colors"
          >
            <Fingerprint className="w-5 h-5" />
            Use Fingerprint
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PinVerifyDialog;
