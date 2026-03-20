/**
 * AuthContext.tsx
 *
 * signUp  — creates account, stores verification token, sends email via email.ts
 * signIn  — checks profiles.is_verified after Supabase auth succeeds
 * resendVerification — generates new token + resends via email.ts
 *
 * Verification email uses email.ts full fallback chain:
 *   EmailJS → Nodemailer server → Resend (same as all other client emails)
 */

import {
  createContext, useContext, useEffect, useState, ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/supabase";
import { sendEmail, buildVerificationEmail } from "@/lib/email";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContextType {
  user:    User | null;
  session: Session | null;
  loading: boolean;
  signUp:  (email: string, password: string) => Promise<{ error: Error | null; needsVerification?: boolean }>;
  signIn:  (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resendVerification: (email: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Generate a secure random hex token
function generateToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user,    setUser]    = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── signUp ────────────────────────────────────────────────────────────────
  const signUp = async (email: string, password: string) => {
    // 1. Create Supabase auth user (email confirmation disabled in Supabase dashboard)
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error as Error };

    const userId = data.user?.id;
    if (!userId) return { error: new Error("Signup failed — no user ID returned") };

    // 2. Generate token + expiry
    const token     = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // 3. Sign user back out — they must verify email first
    await supabase.auth.signOut();

    // 4. Store token on profile (trigger already created the row)
    await new Promise(r => setTimeout(r, 400)); // let trigger settle
    const { error: profileErr } = await db
      .from("profiles")
      .update({
        is_verified:             false,
        verification_token:      token,
        verification_expires_at: expiresAt,
      })
      .eq("id", userId);

    if (profileErr) {
      console.error("[auth] Failed to store verification token:", profileErr.message);
    }

    // 5. Send verification email via full fallback chain (EmailJS → Nodemailer → Resend)
    const emailOpts = buildVerificationEmail(token);
    sendEmail({ to: email, ...emailOpts }).then(result => {
      if (!result.success) console.error("[auth] Verification email failed:", result.error);
      else console.log("[auth] Verification email sent via", result.service);
    });

    return { error: null, needsVerification: true };
  };

  // ── signIn ────────────────────────────────────────────────────────────────
  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error as Error };

    // Check our own is_verified flag
    const { data: profile } = await db
      .from("profiles")
      .select("is_verified")
      .eq("email", email)
      .maybeSingle();

    if (profile && profile.is_verified === false) {
      await supabase.auth.signOut();
      return {
        error: new Error(
          "Please verify your email before signing in. Check your inbox for a verification link."
        ),
      };
    }

    return { error: null };
  };

  // ── resendVerification ────────────────────────────────────────────────────
  const resendVerification = async (email: string): Promise<{ error: string | null }> => {
    const { data: profile } = await db
      .from("profiles")
      .select("id, is_verified")
      .eq("email", email)
      .maybeSingle();

    if (!profile)           return { error: "No account found for this email." };
    if (profile.is_verified) return { error: "This email is already verified. Please sign in." };

    const token     = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await db.from("profiles").update({
      verification_token:      token,
      verification_expires_at: expiresAt,
    }).eq("id", profile.id);

    const emailOpts = buildVerificationEmail(token);
    const result = await sendEmail({ to: email, ...emailOpts });
    if (!result.success) {
      console.error("[auth] Resend verification failed:", result.error);
      return { error: "Failed to send email. Please try again." };
    }

    return { error: null };
  };

  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signOut, resendVerification }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};