-- ============================================================
-- MIGRATION: Settlement safety + idempotency + bank-detail retry
--
-- Problems solved:
--   1. Ghost-completed: DB said "completed" but Payscrow never got the call
--      → Fix: "settling" lock status. Only flip to "completed" AFTER Payscrow confirms.
--
--   2. Double-execution: cron runs twice, sends money twice
--      → Fix: settlement_initiated_at column. If set, payscrow-release bails out early.
--
--   3. Auto-execute fails due to missing bank details, receipt stuck forever
--      → Fix: "pending_bank_details" status. UI shows a retry button.
--
--   4. Evidence storage leak after resolution
--      → Fix: cleanupDisputes replaces file_path with '/placeholder.svg' in DB
--             after removing from storage, so no orphaned DB rows.
-- ============================================================

-- 1. Add settlement lock column to receipts
--    Set to NOW() when settlement begins, cleared on failure/revert.
--    If not null and receipt is active/dispute, a settlement is already in flight.
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS settlement_initiated_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Add which_party_missing_bank column for targeted error messages
--    Values: null | 'sender' | 'receiver' | 'both'
--    Set when auto-execute fails due to missing bank details.
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS pending_bank_party TEXT DEFAULT NULL;

-- 3. Add settlement_decision column
--    Stores the pending decision when status = 'pending_bank_details'
--    so the retry knows what to execute.
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS settlement_decision TEXT DEFAULT NULL;

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS settlement_decision_amount NUMERIC DEFAULT NULL;

-- 4. Allow 'settling' and 'pending_bank_details' as valid status values
--    (no constraint to change — status is TEXT, any value works)
--    Document the full set:
--    pending | active | settling | pending_bank_details | dispute | unresolved | completed

-- 5. Index on settlement_initiated_at for fast idempotency checks
CREATE INDEX IF NOT EXISTS idx_receipts_settlement_initiated
  ON public.receipts (settlement_initiated_at)
  WHERE settlement_initiated_at IS NOT NULL;

-- 6. Index on status + decision_auto_execute_at for cron query performance
CREATE INDEX IF NOT EXISTS idx_receipts_cron_auto_execute
  ON public.receipts (status, decision_auto_execute_at)
  WHERE status = 'active' AND decision_auto_execute_at IS NOT NULL;

-- 7. Index on status for dispute escalation query
CREATE INDEX IF NOT EXISTS idx_receipts_dispute_status
  ON public.receipts (status)
  WHERE status = 'dispute';