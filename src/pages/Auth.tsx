/**
 * Auth.tsx
 *
 * FLOWS:
 *
 * SIGN IN (existing verified user):
 *   email → [invisible probe] → pin entry → sign in → redirect
 *
 * SIGN UP (new user):
 *   email → [invisible probe] → create PIN → confirm PIN
 *   → account created → verification email sent → "check your email" screen
 *
 * EMAIL VERIFICATION (user clicks link):
 *   /auth?mode=verify&token=xxx
 *   → verify-email edge function validates token → is_verified = true
 *   → "Email verified! Enter your PIN to sign in" → pin screen → sign in
 *
 * PIN RESET:
 *   pin screen → "Forgot PIN?" → reset-pin edge function → email sent
 *   → "check your email" screen → user clicks link → /auth?mode=reset
 *   → new-pin → confirm-new-pin → signed in
 *
 * PROBE (invisible):
 *   Attempts signInWithPassword with a dummy password silently in the background.
 *   Error message determines account state. User never sees this happening —
 *   they just see a loading spinner on the Continue button.
 *
 * UNVERIFIED EXISTING USER:
 *   email → [probe finds user] → pin screen → signs in → is_verified=false
 *   → signIn in AuthContext blocks it → shows error with "Resend link" option
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Eye, EyeOff, KeyRound, Loader2, Mail, CheckCircle } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";

type AuthStep =
  | "email"
  | "pin"
  | "create-pin"
  | "confirm-pin"
  | "verify-email"      // "check your inbox" after signup
  | "email-verified"    // "verified! now enter PIN" after clicking link
  | "reset-sent"
  | "new-pin"
  | "confirm-new-pin";

const Auth = () => {
  const [searchParams]                              = useSearchParams();
  const navigate                                    = useNavigate();
  const { user, signIn, signUp, resendVerification } = useAuth();

  const [step,       setStep]       = useState<AuthStep>("email");
  const [email,      setEmail]      = useState("");
  const [pin,        setPin]        = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin,    setShowPin]    = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [resending,  setResending]  = useState(false);

  const redirectTo = decodeURIComponent(searchParams.get("redirect") || "/dashboard");

  // ── Handle ?mode=verify (user clicked verification link) ─────────────────
  useEffect(() => {
    if (searchParams.get("mode") !== "verify") return;

    const token = searchParams.get("token");
    if (!token) {
      toast.error("Invalid verification link.");
      return;
    }

    const verify = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("verify-email", {
          body: { token },
        });

        if (error || !data?.success) {
          const msg = data?.error || "This link is invalid or has expired.";
          if (data?.expired) {
            toast.error("Verification link expired. Please sign up again.");
          } else {
            toast.error(msg);
          }
          setStep("email");
        } else {
          // Verified! Pre-fill email and show "verified" screen → then pin
          setEmail(data.email || "");
          setStep("email-verified");
          toast.success("Email verified! Enter your PIN to sign in.");
        }
      } catch {
        toast.error("Verification failed. Please try again.");
        setStep("email");
      }
      setLoading(false);
    };

    verify();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle ?mode=reset (user clicked reset link) ──────────────────────────
  useEffect(() => {
    if (searchParams.get("mode") !== "reset") return;

    const detectSession = async () => {
      await new Promise(r => setTimeout(r, 200));
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.email) {
        setEmail(session.user.email);
        setStep("new-pin");
        return;
      }
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session?.user?.email) {
          setEmail(session.user.email);
          setStep("new-pin");
          subscription.unsubscribe();
        }
      });
      setTimeout(() => subscription.unsubscribe(), 10000);
    };
    detectSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Redirect already-authenticated users ──────────────────────────────────
  useEffect(() => {
    if (user && !["new-pin", "confirm-new-pin"].includes(step)) {
      navigate(redirectTo, { replace: true });
    }
  }, [user, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step: Email — invisible probe to determine account state ─────────────
  // The user sees a loading spinner. They don't see "Invalid credentials" —
  // that's an internal signal we use to route them to the right next step.
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);

    const emailLower = email.trim().toLowerCase();

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email:    emailLower,
        password: "__probe__" + Math.random(), // clearly wrong, always fails
      });

      const msg = error?.message?.toLowerCase() || "";

      if (!error || msg.includes("invalid login credentials") || msg.includes("invalid credentials")) {
        // User exists → show PIN entry
        setStep("pin");
      } else if (msg.includes("email not confirmed")) {
        // Supabase-level unconfirmed (shouldn't happen since we disabled it, but handle it)
        setStep("verify-email");
      } else {
        // Any other error (user not found, 400, etc.) → new user
        setStep("create-pin");
      }
    } catch {
      setStep("create-pin");
    }

    setLoading(false);
  };

  // ── Step: Sign in ─────────────────────────────────────────────────────────
  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email.trim().toLowerCase(), pin);
    setLoading(false);

    if (error) {
      const msg = error.message || "";
      if (msg.toLowerCase().includes("verify your email")) {
        // AuthContext blocked login — user not verified
        // Don't toast — show inline action instead
        setStep("verify-email");
      } else {
        toast.error("Incorrect PIN. Please try again.");
        setPin("");
      }
    } else {
      navigate(redirectTo, { replace: true });
    }
  };

  // ── Step: Create PIN ──────────────────────────────────────────────────────
  const handleCreatePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6) return;
    setConfirmPin("");
    setStep("confirm-pin");
  };

  // ── Step: Confirm PIN → sign up ───────────────────────────────────────────
  const handleConfirmPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmPin !== pin) return;
    setLoading(true);

    const { error, needsVerification } = await signUp(email.trim().toLowerCase(), pin);
    setLoading(false);

    if (error) {
      const msg = error.message?.toLowerCase() || "";
      if (msg.includes("already registered") || msg.includes("already exists") || msg.includes("unique")) {
        toast.error("An account with this email already exists. Please sign in.");
        clearPins();
        setStep("pin");
      } else {
        toast.error(error.message || "Something went wrong. Please try again.");
      }
      return;
    }

    if (needsVerification) {
      setStep("verify-email");
    }
  };

  // ── Step: Request PIN reset ───────────────────────────────────────────────
  const handleResetPin = async () => {
    if (!email.trim()) { toast.error("Please enter your email first"); return; }
    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke("reset-pin", {
        body: { email: email.trim().toLowerCase() },
      });
      if (error) toast.error("Failed to send reset link. Please try again.");
      else { setStep("reset-sent"); toast.success("Reset link sent! Check your email."); }
    } catch {
      toast.error("Something went wrong. Please try again.");
    }
    setLoading(false);
  };

  // ── Step: Resend verification ─────────────────────────────────────────────
  const handleResendVerification = async () => {
    if (!email.trim()) return;
    setResending(true);
    const { error } = await resendVerification(email.trim().toLowerCase());
    setResending(false);
    if (error) toast.error(error);
    else toast.success("New verification link sent! Check your email.");
  };

  // ── Step: New PIN ─────────────────────────────────────────────────────────
  const handleNewPinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6) return;
    setConfirmPin("");
    setStep("confirm-new-pin");
  };

  const handleConfirmNewPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmPin !== pin) return;
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pin });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Failed to update PIN. Please try again.");
    } else {
      toast.success("PIN updated! Signing you in...");
      setPin(""); setConfirmPin("");
      navigate(redirectTo, { replace: true });
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const clearPins = () => { setPin(""); setConfirmPin(""); setShowPin(false); };

  const handleBack = () => {
    if (step === "confirm-pin")     { setConfirmPin(""); setStep("create-pin"); }
    else if (step === "confirm-new-pin") { setConfirmPin(""); setStep("new-pin"); }
    else                            { clearPins(); setStep("email"); }
  };

  const stepMeta: Record<AuthStep, { title: string; subtitle: string }> = {
    "email":          { title: "Welcome to Surer",  subtitle: "Enter your email to continue"         },
    "pin":            { title: "Enter your PIN",    subtitle: "Your 6-digit PIN"                     },
    "create-pin":     { title: "Create your PIN",   subtitle: "Choose a secure 6-digit PIN"          },
    "confirm-pin":    { title: "Confirm your PIN",  subtitle: "Enter the same PIN again"             },
    "verify-email":   { title: "Check your email",  subtitle: `Verification link sent to ${email}`   },
    "email-verified": { title: "Email verified! 🎉", subtitle: "Now enter your PIN to sign in"       },
    "reset-sent":     { title: "Check your email",  subtitle: `Reset link sent to ${email}`         },
    "new-pin":        { title: "Set new PIN",       subtitle: "Choose a new 6-digit PIN"             },
    "confirm-new-pin":{ title: "Confirm new PIN",   subtitle: "Enter the same PIN again"             },
  };

  const PinInput = ({
    value, onChange, onSubmit, buttonText, disabled = false,
  }: {
    value: string; onChange: (v: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    buttonText: string; disabled?: boolean;
  }) => (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="relative">
        <Input
          type={showPin ? "text" : "password"}
          placeholder="••••••"
          maxLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
          required autoFocus
          className="h-14 text-center text-2xl tracking-[0.5em] font-mono pr-12"
        />
        <button type="button" onClick={() => setShowPin(!showPin)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
          aria-label={showPin ? "Hide PIN" : "Show PIN"}>
          {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
        </button>
      </div>
      <Button variant="hero" size="lg" className="w-full"
        disabled={value.length !== 6 || loading || disabled}>
        {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Please wait...</> : buttonText}
      </Button>
    </form>
  );

  if (loading && step === "email" && searchParams.get("mode") === "verify") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Verifying your email...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-8">

        <div className="text-center space-y-2">
          <Link to="/" className="inline-flex items-center gap-2 mb-4">
            <Logo size="lg" />
            <span className="font-display text-2xl font-bold text-foreground">Surer</span>
          </Link>
          <h1 className="font-display text-2xl font-bold text-foreground">{stepMeta[step].title}</h1>
          <p className="text-sm text-muted-foreground">{stepMeta[step].subtitle}</p>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={step}
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>

            {step === "email" && (
              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <Input type="email" placeholder="you@example.com" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required autoFocus className="h-14 text-base" />
                <Button variant="hero" size="lg" className="w-full"
                  disabled={loading || !email.trim()}>
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking...</> : "Continue"}
                </Button>
              </form>
            )}

            {step === "pin" && (
              <div className="space-y-4">
                <div className="bg-secondary rounded-xl p-3 text-center">
                  <p className="text-sm font-medium text-foreground">{email}</p>
                </div>
                <PinInput value={pin} onChange={setPin} onSubmit={handlePinSubmit} buttonText="Sign In" />
                <button type="button" onClick={handleResetPin} disabled={loading}
                  className="flex items-center gap-1.5 mx-auto text-sm text-primary hover:underline disabled:opacity-50">
                  <KeyRound className="w-3.5 h-3.5" /> Forgot PIN? Reset via email
                </button>
              </div>
            )}

            {step === "create-pin" && (
              <div className="space-y-4">
                <div className="bg-secondary rounded-xl p-3 text-center">
                  <p className="text-xs text-muted-foreground">Creating account for</p>
                  <p className="text-sm font-medium text-foreground">{email}</p>
                </div>
                <PinInput value={pin} onChange={setPin} onSubmit={handleCreatePin} buttonText="Continue" />
              </div>
            )}

            {step === "confirm-pin" && (
              <div className="space-y-3">
                <PinInput value={confirmPin} onChange={setConfirmPin} onSubmit={handleConfirmPin}
                  buttonText="Create Account"
                  disabled={confirmPin.length === 6 && confirmPin !== pin} />
                {confirmPin.length === 6 && confirmPin !== pin && (
                  <p className="text-sm text-destructive text-center">PINs don't match</p>
                )}
              </div>
            )}

            {/* ── Verify email — shown after signup ──────────────────── */}
            {step === "verify-email" && (
              <div className="text-center space-y-5">
                <div className="w-16 h-16 mx-auto rounded-full bg-accent/10 flex items-center justify-center">
                  <Mail className="w-8 h-8 text-accent" />
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">We sent a verification link to</p>
                  <p className="text-sm font-semibold text-foreground">{email}</p>
                  <p className="text-xs text-muted-foreground">
                    Click the link in your email to activate your account.
                    You cannot sign in until your email is verified.
                  </p>
                </div>
                <button type="button" onClick={handleResendVerification}
                  disabled={resending}
                  className="block mx-auto text-sm text-primary hover:underline disabled:opacity-50">
                  {resending ? <><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Sending...</> : "Resend verification link"}
                </button>
                <Button variant="outline" size="lg" className="w-full"
                  onClick={() => { clearPins(); setStep("email"); }}>
                  Back to Sign In
                </Button>
              </div>
            )}

            {/* ── Email verified — shown after clicking link ─────────── */}
            {step === "email-verified" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 bg-accent/10 rounded-xl p-4">
                  <CheckCircle className="w-5 h-5 text-accent shrink-0" />
                  <p className="text-sm text-foreground">
                    Your email <strong>{email}</strong> has been verified.
                  </p>
                </div>
                <PinInput value={pin} onChange={setPin} onSubmit={handlePinSubmit} buttonText="Sign In" />
              </div>
            )}

            {step === "reset-sent" && (
              <div className="text-center space-y-5">
                <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                  <KeyRound className="w-8 h-8 text-primary" />
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Reset link sent to</p>
                  <p className="text-sm font-semibold text-foreground">{email}</p>
                  <p className="text-xs text-muted-foreground">
                    Click the link in the email to set your new PIN.
                    Check your spam folder if you don't see it.
                  </p>
                </div>
                <Button variant="outline" size="lg" className="w-full"
                  onClick={() => { clearPins(); setStep("email"); }}>
                  Back to Sign In
                </Button>
                <button type="button" onClick={handleResetPin} disabled={loading}
                  className="block mx-auto text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-50">
                  {loading ? "Sending..." : "Resend link"}
                </button>
              </div>
            )}

            {step === "new-pin" && (
              <div className="space-y-4">
                <div className="bg-secondary rounded-xl p-3 text-center">
                  <p className="text-xs text-muted-foreground">Setting new PIN for</p>
                  <p className="text-sm font-medium text-foreground">{email}</p>
                </div>
                <PinInput value={pin} onChange={setPin} onSubmit={handleNewPinSubmit} buttonText="Continue" />
              </div>
            )}

            {step === "confirm-new-pin" && (
              <div className="space-y-3">
                <PinInput value={confirmPin} onChange={setConfirmPin} onSubmit={handleConfirmNewPin}
                  buttonText="Update PIN"
                  disabled={confirmPin.length === 6 && confirmPin !== pin} />
                {confirmPin.length === 6 && confirmPin !== pin && (
                  <p className="text-sm text-destructive text-center">PINs don't match</p>
                )}
              </div>
            )}

          </motion.div>
        </AnimatePresence>

        {!["email", "verify-email", "email-verified", "reset-sent", "new-pin"].includes(step) && (
          <button onClick={handleBack}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mx-auto transition-colors">
            <ArrowLeft className="w-4 h-4" /> Go back
          </button>
        )}

      </motion.div>
    </div>
  );
};

export default Auth;