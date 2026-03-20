import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Query profiles table — single row lookup, fast at any scale.
    // profiles.email is populated by the handle_new_user trigger on signup.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    // Not in profiles → never signed up
    if (!profile) {
      return new Response(
        JSON.stringify({ exists: false, verified: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Profile exists — now check if email is confirmed via auth.users
    // Use the admin REST API directly (JS SDK has no getUserByEmail)
    const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const res = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(`email=eq.${email.trim().toLowerCase()}`)}`,
      {
        headers: {
          "apikey":        serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
        },
      }
    );

    // If REST call fails for any reason, default to verified=true
    // so existing users are never locked out
    if (!res.ok) {
      return new Response(
        JSON.stringify({ exists: true, verified: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data   = await res.json();
    const users  = Array.isArray(data) ? data : (data?.users ?? []);
    const user   = users[0];
    const verified = user ? !!user.email_confirmed_at : true;

    return new Response(
      JSON.stringify({ exists: true, verified }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[check-email] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});