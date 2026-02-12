import { supabase } from "@/integrations/supabase/client";

// Helper to bypass type checking while types are being generated
// All supabase calls go through this to avoid TS errors with stale types
export const db = supabase as any;
