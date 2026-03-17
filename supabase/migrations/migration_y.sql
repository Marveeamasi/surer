-- ============================================================
-- MIGRATION: bank_list_cache table
--
-- Stores the Payscrow-supported bank list fetched by the
-- payscrow-get-banks edge function. Single row (id=1).
-- TTL is enforced in the edge function (24 hours).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bank_list_cache (
  id      INTEGER PRIMARY KEY DEFAULT 1,          -- Always row 1, upserted
  banks   JSONB   NOT NULL DEFAULT '[]'::jsonb,   -- Array of {name, code}
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Enforce single row
  CONSTRAINT bank_list_cache_single_row CHECK (id = 1)
);

ALTER TABLE public.bank_list_cache ENABLE ROW LEVEL SECURITY;

-- Everyone can read (needed by frontend via edge function, or direct if you prefer)
CREATE POLICY "bank_list_cache_read_all" ON public.bank_list_cache
  FOR SELECT USING (true);

-- Only service role can write (edge function uses service role key)
-- No INSERT/UPDATE policy needed for anon/authenticated — edge function handles it