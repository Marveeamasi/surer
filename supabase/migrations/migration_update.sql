

-- 1. Create fee_settings table
--    Admin sets: fee_percentage (default 3.5), base_fee (default 100), fee_cap (default 2000)
CREATE TABLE IF NOT EXISTS public.fee_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_percentage NUMERIC NOT NULL DEFAULT 3.5,   -- e.g. 3.5 means 3.5%
  base_fee NUMERIC NOT NULL DEFAULT 100,          -- flat addition in Naira
  fee_cap NUMERIC NOT NULL DEFAULT 2000,          -- maximum protection fee in Naira
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.fee_settings ENABLE ROW LEVEL SECURITY;
-- Allow everyone to read fee settings (needed for CreateReceipt, FeeCalculator, etc.)

-- Insert the default row (only one row ever exists)
INSERT INTO public.fee_settings (fee_percentage, base_fee, fee_cap)
VALUES (3.5, 100, 2000)
ON CONFLICT DO NOTHING;

-- 2. Add protection_fee column to receipts
--    This single column replaces the old split surer_fee + payscrow_fee
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS protection_fee NUMERIC DEFAULT 0;

-- Backfill: if old receipts had surer_fee, migrate to protection_fee
UPDATE public.receipts
SET protection_fee = COALESCE(surer_fee, 0) + COALESCE(payscrow_fee, 0)
WHERE protection_fee = 0
  AND (surer_fee > 0 OR payscrow_fee > 0);


-- ============================================================
-- MIGRATION: Drop deprecated fee columns from receipts
--
-- surer_fee and payscrow_fee are replaced by the single
-- protection_fee column (added in migration_fee_settings.sql).
-- Run this AFTER confirming all active receipts have been
-- migrated / completed. Safe to run in production.
-- ============================================================
 
-- Optional: backfill any remaining receipts that still have
-- old values but no protection_fee yet
UPDATE public.receipts
SET protection_fee = COALESCE(surer_fee, 0) + COALESCE(payscrow_fee, 0)
WHERE (protection_fee IS NULL OR protection_fee = 0)
  AND (COALESCE(surer_fee, 0) + COALESCE(payscrow_fee, 0)) > 0;
 
-- Drop the deprecated columns
ALTER TABLE public.receipts DROP COLUMN IF EXISTS surer_fee;
ALTER TABLE public.receipts DROP COLUMN IF EXISTS payscrow_fee;