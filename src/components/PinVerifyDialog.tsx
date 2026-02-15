import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Fingerprint, Loader2, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

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
  const [useBiometric, setUseBiometric] = useState(false);

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
      // Use WebAuthn for biometric verification
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: new Uint8Array(32),
          timeout: 60000,
          userVerification: "required",
          rpId: window.location.hostname,
        },
      });

      if (credential) {
        onOpenChange(false);
        onVerified();
      }
    } catch {
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

        {/* Biometric option */}
        <button
          type="button"
          onClick={handleBiometric}
          disabled={verifying}
          className="flex items-center justify-center gap-2 w-full py-3 text-sm text-primary hover:text-primary/80 transition-colors"
        >
          <Fingerprint className="w-5 h-5" />
          Use Fingerprint
        </button>
      </DialogContent>
    </Dialog>
  );
};

export default PinVerifyDialog;
