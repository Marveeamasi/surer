CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA extensions;

-- ────────────────────────────────────────────────
-- 1. User roles
-- ────────────────────────────────────────────────
CREATE TABLE public.user_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'user',
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
-- Note: policies are managed manually / outside this file

-- ────────────────────────────────────────────────
-- 2. Profiles
-- ────────────────────────────────────────────────
CREATE TABLE public.profiles (
    id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email               TEXT,
    display_name        TEXT,
    bank_name           TEXT,
    account_number      TEXT,
    account_name        TEXT,
    bank_code           TEXT,
    phone_number        TEXT,   
    is_verified         BOOLEAN ,                       
    verification_token  TEXT,
    verification_expires_at TIMESTAMPTZ,
    webauthn_credential TEXT,
    fingerprint_enabled BOOLEAN DEFAULT false,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
-- Note: policies managed manually

-- ────────────────────────────────────────────────
-- 3. Receipts — final columns
-- ────────────────────────────────────────────────
CREATE TABLE public.receipts (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id                   UUID NOT NULL,
    receiver_id                 UUID,
    receiver_email              TEXT NOT NULL,
    amount                      DECIMAL NOT NULL,
    description                 TEXT NOT NULL,
    status                      TEXT NOT NULL DEFAULT 'pending',
    created_by                  UUID NOT NULL,
    protection_fee              DECIMAL DEFAULT 0,          -- replaced surer_fee + payscrow_fee
    payscrow_transaction_ref    TEXT,
    payscrow_transaction_number TEXT,
    escrow_code                 TEXT,
    paid_at                     TIMESTAMPTZ,
    amount_paid                 DECIMAL,
    
    -- Decision fields
    sender_decision             TEXT,
    sender_decision_reason      TEXT,
    sender_decision_amount      NUMERIC,
    receiver_decision           TEXT,
    receiver_decision_reason    TEXT,
    decision_auto_execute_at    TIMESTAMPTZ,
    
    -- Settlement safety & retry support (added in w/x)
    settlement_initiated_at     TIMESTAMPTZ DEFAULT NULL,
    pending_bank_party          TEXT DEFAULT NULL,          -- null | 'sender' | 'receiver' | 'both'
    settlement_decision         TEXT DEFAULT NULL,
    settlement_decision_amount  NUMERIC DEFAULT NULL,

    created_at                  TIMESTAMPTZ DEFAULT now(),
    updated_at                  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
-- Note: policies managed manually

-- ────────────────────────────────────────────────
-- 4. Disputes
-- ────────────────────────────────────────────────
CREATE TABLE public.disputes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id      UUID NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
    initiated_by    UUID NOT NULL,
    reason          TEXT NOT NULL,
    proposed_action TEXT NOT NULL,
    proposed_amount DECIMAL,
    status          TEXT NOT NULL DEFAULT 'open',
    expires_at      TIMESTAMPTZ,
    auto_execute_at TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
-- Note: policies managed manually

-- ────────────────────────────────────────────────
-- 5. Evidence
-- ────────────────────────────────────────────────
CREATE TABLE public.evidence (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id  UUID NOT NULL REFERENCES public.disputes(id) ON DELETE CASCADE,
    uploaded_by UUID NOT NULL,
    file_path   TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'file',
    created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;
-- Note: policies managed manually

-- ────────────────────────────────────────────────
-- 6. Admin decisions
-- ────────────────────────────────────────────────
CREATE TABLE public.admin_decisions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id  UUID NOT NULL REFERENCES public.disputes(id) ON DELETE CASCADE,
    decided_by  UUID NOT NULL,
    decision    TEXT NOT NULL,
    release_amount DECIMAL,
    created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.admin_decisions ENABLE ROW LEVEL SECURITY;
-- Note: policies managed manually

-- ────────────────────────────────────────────────
-- 7. Fee settings (single row)
-- ────────────────────────────────────────────────
CREATE TABLE public.fee_settings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fee_percentage  NUMERIC NOT NULL DEFAULT 3.5,
    base_fee        NUMERIC NOT NULL DEFAULT 100,
    fee_cap         NUMERIC NOT NULL DEFAULT 2000,
    updated_by      UUID REFERENCES auth.users(id),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.fee_settings ENABLE ROW LEVEL SECURITY;
-- Note: policies managed manually

-- ────────────────────────────────────────────────
-- 8. Bank list cache (single row)
-- ────────────────────────────────────────────────
CREATE TABLE public.bank_list_cache (
    id          INTEGER PRIMARY KEY DEFAULT 1,
    banks       JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT bank_list_cache_single_row CHECK (id = 1)
);
ALTER TABLE public.bank_list_cache ENABLE ROW LEVEL SECURITY;
-- Note: policies managed manually

-- ────────────────────────────────────────────────
-- Triggers
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_receipts_updated_at
    BEFORE UPDATE ON public.receipts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ────────────────────────────────────────────────
-- Storage bucket
-- ────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence', 'evidence', true)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────
-- Performance indexes (final set)
-- ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_receipts_settlement_initiated
    ON public.receipts (settlement_initiated_at)
    WHERE settlement_initiated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receipts_cron_auto_execute
    ON public.receipts (status, decision_auto_execute_at)
    WHERE status = 'active' AND decision_auto_execute_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receipts_dispute_status
    ON public.receipts (status)
    WHERE status = 'dispute';

CREATE INDEX IF NOT EXISTS idx_profiles_verification_token
  ON public.profiles (verification_token)
  WHERE verification_token IS NOT NULL;