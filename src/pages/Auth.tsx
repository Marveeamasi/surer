import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, ArrowLeft, Eye, EyeOff, CheckCircle, KeyRound, Loader2 } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type AuthStep = "email" | "pin" | "create-pin" | "confirm-pin" | "verify-email" | "reset-pin" | "new-pin" | "confirm-new-pin";

const Auth = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, signIn, signUp } = useAuth();

  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);

  // Handle reset mode from email link - user arrives with a session from the reset link
  useEffect(() => {
    const mode = searchParams.get("mode");
    if (mode === "reset") {
      // User clicked reset link in email - they have a session now
      // Extract email from session and go straight to new-pin
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user?.email) {
          setEmail(session.user.email);
          setStep("new-pin");
        } else {
          // No session yet, wait for auth state change
          const timeout = setTimeout(() => {
            supabase.auth.getSession().then(({ data: { session: s } }) => {
              if (s?.user?.email) {
                setEmail(s.user.email);
                setStep("new-pin");
              }
            });
          }, 1500);
          return () => clearTimeout(timeout);
        }
      });
    }
  }, [searchParams]);

  // If already logged in and not in reset mode, redirect
  useEffect(() => {
    if (user && step !== "new-pin" && step !== "confirm-new-pin") {
      const redirect = searchParams.get("redirect");
      navigate(redirect || "/dashboard");
    }
  }, [user, step]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("check-email", {
        body: { email },
      });

      if (error) {
        toast.error("Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      if (data.exists && data.verified) {
        setStep("pin");
      } else if (data.exists && !data.verified) {
        setStep("verify-email");
      } else {
        setStep("create-pin");
      }
    } catch {
      setStep("create-pin");
    }
    setLoading(false);
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, pin);
    setLoading(false);
    if (error) {
      toast.error(error.message || "Invalid PIN. Please try again.");
    } else {
      const redirect = searchParams.get("redirect");
      navigate(redirect || "/dashboard");
    }
  };

  const handleCreatePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6) return;
    setStep("confirm-pin");
  };

  const handleConfirmPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmPin !== pin) return;
    setLoading(true);
    const { error } = await signUp(email, pin);
    setLoading(false);
    if (error) {
      toast.error(error.message || "Something went wrong");
    } else {
      setStep("verify-email");
    }
  };

  const handleResetPin = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke("reset-pin", {
        body: { email },
      });
      if (error) {
        toast.error("Failed to send reset link");
      } else {
        toast.success("Reset link sent to your email!");
        setStep("reset-pin");
      }
    } catch {
      toast.error("Something went wrong");
    }
    setLoading(false);
  };

  const handleNewPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6) return;
    setStep("confirm-new-pin");
  };

  const handleConfirmNewPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmPin !== pin) return;
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pin });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Failed to update PIN");
    } else {
      toast.success("PIN updated successfully! Signing you in...");
      setPin("");
      setConfirmPin("");
      // User is already signed in via the reset link session, redirect
      navigate("/dashboard");
    }
  };

  const resetState = () => {
    setPin("");
    setConfirmPin("");
    setShowPin(false);
  };

  const stepTitles: Record<AuthStep, { title: string; subtitle: string }> = {
    email: { title: "Welcome to Surer", subtitle: "Enter your email to get started" },
    pin: { title: "Enter your PIN", subtitle: "Enter your 6-digit PIN to sign in" },
    "create-pin": { title: "Create your PIN", subtitle: "Choose a 6-digit PIN as your password" },
    "confirm-pin": { title: "Confirm your PIN", subtitle: "Enter the same PIN again to confirm" },
    "verify-email": { title: "Verify your email", subtitle: `We sent a verification link to ${email}` },
    "reset-pin": { title: "Check your email", subtitle: `We sent a PIN reset link to ${email}` },
    "new-pin": { title: "Set new PIN", subtitle: `Setting new PIN for ${email}` },
    "confirm-new-pin": { title: "Confirm new PIN", subtitle: "Enter the same PIN again" },
  };

  const PinInput = ({ value, onChange, onSubmit, buttonText, disabled }: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    buttonText: string;
    disabled?: boolean;
  }) => (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="relative">
        <Input
          type={showPin ? "text" : "password"}
          placeholder="••••••"
          maxLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
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
      <Button variant="hero" size="lg" className="w-full" disabled={value.length !== 6 || loading || disabled}>
        {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Please wait...</> : buttonText}
      </Button>
    </form>
  );

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-8"
      >
        {/* Logo */}
        <div className="text-center space-y-2">
          <Link to="/" className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-hero flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-display text-2xl font-bold text-foreground">Surer</span>
          </Link>
          <h1 className="font-display text-2xl font-bold text-foreground">
            {stepTitles[step].title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {stepTitles[step].subtitle}
          </p>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {/* Verify email */}
            {step === "verify-email" && (
              <div className="text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-accent/10 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-accent" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Click the link in your email to verify your account, then come back to sign in.
                </p>
                <Button variant="hero" size="lg" className="w-full" onClick={() => { resetState(); setStep("email"); }}>
                  Back to Sign In
                </Button>
              </div>
            )}

            {/* Reset PIN sent */}
            {step === "reset-pin" && (
              <div className="text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                  <KeyRound className="w-8 h-8 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Click the link in your email to reset your PIN. After clicking the link, you'll be able to set a new PIN.
                </p>
                <Button variant="hero" size="lg" className="w-full" onClick={() => { resetState(); setStep("email"); }}>
                  Back to Sign In
                </Button>
              </div>
            )}

            {/* Email step */}
            {step === "email" && (
              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="h-14 text-base"
                />
                <Button variant="hero" size="lg" className="w-full" disabled={loading}>
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking...</> : "Continue"}
                </Button>
              </form>
            )}

            {/* PIN login */}
            {step === "pin" && (
              <div className="space-y-4">
                <PinInput
                  value={pin}
                  onChange={setPin}
                  onSubmit={handlePinSubmit}
                  buttonText="Sign In"
                />
                <button
                  type="button"
                  onClick={handleResetPin}
                  className="block mx-auto text-sm text-primary hover:underline"
                  disabled={loading}
                >
                  <KeyRound className="w-3.5 h-3.5 inline mr-1" />
                  Change PIN
                </button>
              </div>
            )}

            {/* Create PIN */}
            {step === "create-pin" && (
              <PinInput value={pin} onChange={setPin} onSubmit={handleCreatePin} buttonText="Continue" />
            )}

            {/* Confirm PIN */}
            {step === "confirm-pin" && (
              <div className="space-y-3">
                <PinInput
                  value={confirmPin}
                  onChange={setConfirmPin}
                  onSubmit={handleConfirmPin}
                  buttonText="Create Account"
                  disabled={confirmPin.length === 6 && confirmPin !== pin}
                />
                {confirmPin.length === 6 && confirmPin !== pin && (
                  <p className="text-sm text-destructive text-center">PINs don't match</p>
                )}
              </div>
            )}

            {/* New PIN (after reset) */}
            {step === "new-pin" && (
              <div className="space-y-3">
                <div className="bg-secondary rounded-xl p-3 text-center">
                  <p className="text-sm text-foreground font-medium">{email}</p>
                </div>
                <PinInput value={pin} onChange={setPin} onSubmit={handleNewPinSubmit} buttonText="Continue" />
              </div>
            )}

            {/* Confirm new PIN */}
            {step === "confirm-new-pin" && (
              <div className="space-y-3">
                <PinInput
                  value={confirmPin}
                  onChange={setConfirmPin}
                  onSubmit={handleConfirmNewPin}
                  buttonText="Update PIN"
                  disabled={confirmPin.length === 6 && confirmPin !== pin}
                />
                {confirmPin.length === 6 && confirmPin !== pin && (
                  <p className="text-sm text-destructive text-center">PINs don't match</p>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Back button */}
        {step !== "email" && step !== "verify-email" && step !== "reset-pin" && (
          <button
            onClick={() => {
              if (step === "confirm-pin" || step === "confirm-new-pin") {
                setConfirmPin("");
                setStep(step === "confirm-pin" ? "create-pin" : "new-pin");
              } else {
                resetState();
                setStep("email");
              }
            }}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mx-auto transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Go back
          </button>
        )}
      </motion.div>
    </div>
  );
};

export default Auth;
