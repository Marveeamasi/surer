import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();

    if (!token || typeof token !== "string" || token.length < 10) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing verification token." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Look up the token ─────────────────────────────────────────────────
    const { data: profile, error: lookupErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, is_verified, verification_token, verification_expires_at")
      .eq("verification_token", token)
      .maybeSingle();

    if (lookupErr || !profile) {
      console.error("[verify-email] Token not found:", token.slice(0, 8) + "...");
      return new Response(
        JSON.stringify({ error: "This verification link is invalid or has already been used." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Already verified ──────────────────────────────────────────────────
    if (profile.is_verified) {
      return new Response(
        JSON.stringify({
          success: true,
          email: profile.email,
          alreadyVerified: true,
          message: "Email already verified. Please sign in.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Check expiry ──────────────────────────────────────────────────────
    if (profile.verification_expires_at) {
      const expired = new Date(profile.verification_expires_at).getTime() < Date.now();
      if (expired) {
        console.log("[verify-email] Token expired for:", profile.email);
        return new Response(
          JSON.stringify({
            error: "This verification link has expired. Please sign up again to get a new link.",
            expired: true,
            email: profile.email,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Mark verified ─────────────────────────────────────────────────────
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({
        is_verified:              true,
        verification_token:       null,
        verification_expires_at:  null,
      })
      .eq("id", profile.id);

    if (updateErr) {
      console.error("[verify-email] Update error:", updateErr.message);
      return new Response(
        JSON.stringify({ error: "Verification failed. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[verify-email] Verified:", profile.email);

    return new Response(
      JSON.stringify({
        success: true,
        email: profile.email,
        message: "Email verified! Please enter your PIN to sign in.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[verify-email] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});