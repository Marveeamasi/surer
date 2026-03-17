-- ============================================================
-- MIGRATION: Settlement safety + idempotency + phone_number
--
-- 1. Settlement lock (settling status + initiated_at timestamp)
-- 2. pending_bank_details tracking columns
-- 3. phone_number on profiles (real Nigerian phone, set when user adds bank details)
-- 4. Performance indexes
-- ============================================================

-- 1. Settlement lock: marks a receipt as "in flight" to prevent double-execution
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS settlement_initiated_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Which party is blocking settlement due to missing bank details
--    Values: null | 'sender' | 'receiver' | 'both'
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS pending_bank_party TEXT DEFAULT NULL;

-- 3. Store the pending decision so retry knows what to execute
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS settlement_decision TEXT DEFAULT NULL;

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS settlement_decision_amount NUMERIC DEFAULT NULL;

-- 4. Phone number on profiles
--    Set by user when they add bank details in Settings.
--    Required alongside bank_code/account_number/account_name.
--    Used in payscrow-create-payment for customerPhoneNo/merchantPhoneNo.
--    If not set, a silent deterministic fallback is generated from user ID in the edge function.
--    Nigerian format enforced in application layer: 070/080/081/090/091 + 8 digits
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_number TEXT DEFAULT NULL;

-- 5. Performance indexes

-- Fast lookup for cron auto-execute query
CREATE INDEX IF NOT EXISTS idx_receipts_cron_auto_execute
  ON public.receipts (status, decision_auto_execute_at)
  WHERE status = 'active' AND decision_auto_execute_at IS NOT NULL;

-- Fast lookup for dispute escalation query
CREATE INDEX IF NOT EXISTS idx_receipts_dispute_status
  ON public.receipts (status)
  WHERE status = 'dispute';

-- Fast lookup for settlement lock check
CREATE INDEX IF NOT EXISTS idx_receipts_settlement_initiated
  ON public.receipts (settlement_initiated_at)
  WHERE settlement_initiated_at IS NOT NULL;