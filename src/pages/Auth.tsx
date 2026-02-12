import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

type AuthStep = "email" | "pin" | "create-pin" | "confirm-pin";

const Auth = () => {
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // In real app, check if email exists
    // For now, simulate new user flow
    setIsNewUser(true);
    setStep("create-pin");
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle login
  };

  const handleCreatePin = (e: React.FormEvent) => {
    e.preventDefault();
    setStep("confirm-pin");
  };

  const handleConfirmPin = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle signup
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
          </h1>
          <p className="text-sm text-muted-foreground">
            {step === "email" && "Enter your email to get started"}
            {step === "pin" && "Enter your 6-digit PIN to sign in"}
            {step === "create-pin" && "Choose a 6-digit PIN as your password"}
            {step === "confirm-pin" && "Enter the same PIN again to confirm"}
          </p>
        </div>

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
            <Button variant="hero" size="lg" className="w-full">
              Continue
            </Button>
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
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <Button variant="hero" size="lg" className="w-full" disabled={pin.length !== 6}>
              Sign In
            </Button>
            <button type="button" className="w-full text-sm text-primary hover:underline">
              Forgot PIN?
            </button>
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
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
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
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {confirmPin.length === 6 && confirmPin !== pin && (
              <p className="text-sm text-destructive">PINs don't match</p>
            )}
            <Button variant="hero" size="lg" className="w-full" disabled={confirmPin.length !== 6 || confirmPin !== pin}>
              Create Account
            </Button>
          </form>
        )}

        {/* Back */}
        {step !== "email" && (
          <button
            onClick={() => setStep(step === "confirm-pin" ? "create-pin" : "email")}
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
