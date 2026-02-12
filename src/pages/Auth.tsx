import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, ArrowLeft, Eye, EyeOff, CheckCircle } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type AuthStep = "email" | "pin" | "create-pin" | "confirm-pin" | "verify-email";

const Auth = () => {
  const [searchParams] = useSearchParams();
  const isSignup = searchParams.get("mode") === "signup";
  const navigate = useNavigate();
  const { signIn, signUp } = useAuth();

  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // For simplicity, route to create or login based on URL param
    if (isSignup) {
      setStep("create-pin");
    } else {
      setStep("pin");
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, pin);
    setLoading(false);
    if (error) {
      toast.error(error.message || "Invalid email or PIN");
    } else {
      navigate("/dashboard");
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
            {step === "email" && "Welcome"}
            {step === "pin" && "Enter your PIN"}
            {step === "create-pin" && "Create your PIN"}
            {step === "confirm-pin" && "Confirm your PIN"}
            {step === "verify-email" && "Check your email"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {step === "email" && "Enter your email to get started"}
            {step === "pin" && "Enter your 6-digit PIN to sign in"}
            {step === "create-pin" && "Choose a 6-digit PIN as your password"}
            {step === "confirm-pin" && "Enter the same PIN again to confirm"}
            {step === "verify-email" && `We sent a verification link to ${email}`}
          </p>
        </div>

        {/* Verify email success */}
        {step === "verify-email" && (
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-accent/10 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-accent" />
            </div>
            <p className="text-sm text-muted-foreground">
              Click the link in your email to verify your account, then come back to sign in.
            </p>
            <Button variant="hero" size="lg" className="w-full" onClick={() => { setStep("email"); setPin(""); setConfirmPin(""); }}>
              Back to Sign In
            </Button>
          </motion.div>
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
              className="h-12 text-base"
            />
            <Button variant="hero" size="lg" className="w-full" disabled={loading}>
              Continue
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {isSignup ? (
                <>Already have an account? <Link to="/auth" className="text-primary hover:underline">Sign in</Link></>
              ) : (
                <>New here? <Link to="/auth?mode=signup" className="text-primary hover:underline">Create account</Link></>
              )}
            </p>
          </form>
        )}

        {/* PIN login */}
        {step === "pin" && (
          <form onSubmit={handlePinSubmit} className="space-y-4">
            <div className="relative">
              <Input
                type={showPin ? "text" : "password"}
                placeholder="••••••"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                required
                className="h-12 text-center text-2xl tracking-[0.5em] font-mono"
              />
              <button type="button" onClick={() => setShowPin(!showPin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <Button variant="hero" size="lg" className="w-full" disabled={pin.length !== 6 || loading}>
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        )}

        {/* Create PIN */}
        {step === "create-pin" && (
          <form onSubmit={handleCreatePin} className="space-y-4">
            <div className="relative">
              <Input
                type={showPin ? "text" : "password"}
                placeholder="••••••"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                required
                className="h-12 text-center text-2xl tracking-[0.5em] font-mono"
              />
              <button type="button" onClick={() => setShowPin(!showPin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <Button variant="hero" size="lg" className="w-full" disabled={pin.length !== 6}>
              Continue
            </Button>
          </form>
        )}

        {/* Confirm PIN */}
        {step === "confirm-pin" && (
          <form onSubmit={handleConfirmPin} className="space-y-4">
            <div className="relative">
              <Input
                type={showPin ? "text" : "password"}
                placeholder="••••••"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                required
                className="h-12 text-center text-2xl tracking-[0.5em] font-mono"
              />
              <button type="button" onClick={() => setShowPin(!showPin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {confirmPin.length === 6 && confirmPin !== pin && (
              <p className="text-sm text-destructive">PINs don't match</p>
            )}
            <Button variant="hero" size="lg" className="w-full" disabled={confirmPin.length !== 6 || confirmPin !== pin || loading}>
              {loading ? "Creating account..." : "Create Account"}
            </Button>
          </form>
        )}

        {/* Back */}
        {step !== "email" && step !== "verify-email" && (
          <button
            onClick={() => {
              if (step === "confirm-pin") setStep("create-pin");
              else { setStep("email"); setPin(""); }
            }}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mx-auto"
          >
            <ArrowLeft className="w-4 h-4" /> Go back
          </button>
        )}
      </motion.div>
    </div>
  );
};

export default Auth;
