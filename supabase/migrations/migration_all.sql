-- ============================================================
-- MIGRATION: 20260212230549_657661dc-8c1f-4586-b7fc-e26e9306b155
-- ============================================================

-- Storage bucket for evidence (using extensions)
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA extensions;

-- ============================================================
-- MIGRATION: 20260213065549_727d4bfc-1e68-44b8-bcd9-59ba4e17d671
-- ============================================================

-- 1. User roles (no deps)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
-- Policies managed manually (all permissions allowed)

-- 2. Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  bank_name TEXT,
  account_number TEXT,
  account_name TEXT,
  fingerprint_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
-- Policies managed manually (all permissions allowed)

-- 3. Receipts
CREATE TABLE public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL,
  receiver_id UUID,
  receiver_email TEXT NOT NULL,
  amount DECIMAL NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by UUID NOT NULL,
  surer_fee DECIMAL DEFAULT 0,
  payscrow_fee DECIMAL DEFAULT 0,
  payscrow_transaction_ref TEXT,
  payscrow_transaction_number TEXT,
  escrow_code TEXT,
  paid_at TIMESTAMP WITH TIME ZONE,
  amount_paid DECIMAL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
-- Policies managed manually (all permissions allowed)

-- 4. Disputes
CREATE TABLE public.disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  initiated_by UUID NOT NULL,
  reason TEXT NOT NULL,
  proposed_action TEXT NOT NULL,
  proposed_amount DECIMAL,
  status TEXT NOT NULL DEFAULT 'open',
  expires_at TIMESTAMP WITH TIME ZONE,
  auto_execute_at TIMESTAMP WITH TIME ZONE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
-- Policies managed manually (all permissions allowed)

-- 5. Evidence
CREATE TABLE public.evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES public.disputes(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL,
  file_path TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'file',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;
-- Policies managed manually (all permissions allowed)

-- 6. Admin decisions
CREATE TABLE public.admin_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES public.disputes(id) ON DELETE CASCADE,
  decided_by UUID NOT NULL,
  decision TEXT NOT NULL,
  release_amount DECIMAL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
ALTER TABLE public.admin_decisions ENABLE ROW LEVEL SECURITY;
-- Policies managed manually (all permissions allowed)

-- 7. Withdrawals
CREATE TABLE public.withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  receipt_id UUID REFERENCES public.receipts(id),
  amount DECIMAL NOT NULL,
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
-- Policies managed manually (all permissions allowed)

-- Triggers
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$ BEGIN INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email) ON CONFLICT (id) DO NOTHING; RETURN NEW; END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_receipts_updated_at BEFORE UPDATE ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage
INSERT INTO storage.buckets (id, name, public) VALUES ('evidence', 'evidence', true) ON CONFLICT (id) DO NOTHING;
-- Policies managed manually (all permissions allowed)

-- ============================================================
-- MIGRATION: 20260214052606_fe513013-d330-460f-ad36-834f8e240e78
-- ============================================================

-- Add decision tracking columns to receipts
ALTER TABLE public.receipts
ADD COLUMN IF NOT EXISTS sender_decision text,
ADD COLUMN IF NOT EXISTS sender_decision_reason text,
ADD COLUMN IF NOT EXISTS sender_decision_amount numeric,
ADD COLUMN IF NOT EXISTS receiver_decision text,
ADD COLUMN IF NOT EXISTS receiver_decision_reason text,
ADD COLUMN IF NOT EXISTS decision_auto_execute_at timestamptz;


-- ============================================================
-- MIGRATION: 20260216131815_44096293-9882-48bb-9422-ff26db955536
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bank_code text;


-- ============================================================
-- MIGRATION: 20260224120000_add_spam_webauthn_columns
-- ============================================================

-- Add spam fee tracking and WebAuthn credential storage

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS spam_fee_paid boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS spam_fee_reference text,
  ADD COLUMN IF NOT EXISTS spam_fee_decision text,
  ADD COLUMN IF NOT EXISTS spam_fee_amount numeric;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS webauthn_credential text;