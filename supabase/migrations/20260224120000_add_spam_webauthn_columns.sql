-- Add spam fee tracking and WebAuthn credential storage

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS spam_fee_paid boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS spam_fee_reference text,
  ADD COLUMN IF NOT EXISTS spam_fee_decision text,
  ADD COLUMN IF NOT EXISTS spam_fee_amount numeric;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS webauthn_credential text;
