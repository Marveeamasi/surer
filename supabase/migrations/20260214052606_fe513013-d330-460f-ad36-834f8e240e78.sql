
-- Add decision tracking columns to receipts
ALTER TABLE public.receipts 
ADD COLUMN IF NOT EXISTS sender_decision text,
ADD COLUMN IF NOT EXISTS sender_decision_reason text,
ADD COLUMN IF NOT EXISTS sender_decision_amount numeric,
ADD COLUMN IF NOT EXISTS receiver_decision text,
ADD COLUMN IF NOT EXISTS receiver_decision_reason text,
ADD COLUMN IF NOT EXISTS decision_auto_execute_at timestamptz;
