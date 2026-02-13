
-- 1. User roles (no deps)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

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
CREATE POLICY "View own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

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
CREATE POLICY "View receipts as participant" ON public.receipts FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id OR auth.uid() = created_by);
CREATE POLICY "Create receipts" ON public.receipts FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Update receipts as participant" ON public.receipts FOR UPDATE USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
CREATE POLICY "Delete pending receipts" ON public.receipts FOR DELETE USING (auth.uid() = created_by AND status = 'pending');

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
CREATE POLICY "View disputes as participant" ON public.disputes FOR SELECT USING (EXISTS (SELECT 1 FROM public.receipts r WHERE r.id = receipt_id AND (auth.uid() = r.sender_id OR auth.uid() = r.receiver_id)));
CREATE POLICY "Create disputes" ON public.disputes FOR INSERT WITH CHECK (auth.uid() = initiated_by);
CREATE POLICY "Update disputes as participant" ON public.disputes FOR UPDATE USING (EXISTS (SELECT 1 FROM public.receipts r WHERE r.id = receipt_id AND (auth.uid() = r.sender_id OR auth.uid() = r.receiver_id)));

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
CREATE POLICY "View evidence as participant" ON public.evidence FOR SELECT USING (EXISTS (SELECT 1 FROM public.disputes d JOIN public.receipts r ON r.id = d.receipt_id WHERE d.id = dispute_id AND (auth.uid() = r.sender_id OR auth.uid() = r.receiver_id)));
CREATE POLICY "Upload evidence" ON public.evidence FOR INSERT WITH CHECK (auth.uid() = uploaded_by);
CREATE POLICY "Delete own evidence" ON public.evidence FOR DELETE USING (auth.uid() = uploaded_by);

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
CREATE POLICY "Admins manage decisions" ON public.admin_decisions FOR ALL USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "Participants view decisions" ON public.admin_decisions FOR SELECT USING (EXISTS (SELECT 1 FROM public.disputes d JOIN public.receipts r ON r.id = d.receipt_id WHERE d.id = dispute_id AND (auth.uid() = r.sender_id OR auth.uid() = r.receiver_id)));

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
CREATE POLICY "View own withdrawals" ON public.withdrawals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Create own withdrawals" ON public.withdrawals FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Triggers
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$ BEGIN INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email) ON CONFLICT (id) DO NOTHING; RETURN NEW; END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_receipts_updated_at BEFORE UPDATE ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage
INSERT INTO storage.buckets (id, name, public) VALUES ('evidence', 'evidence', true) ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Upload evidence files" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'evidence' AND auth.uid() IS NOT NULL);
CREATE POLICY "View evidence files" ON storage.objects FOR SELECT USING (bucket_id = 'evidence' AND auth.uid() IS NOT NULL);
CREATE POLICY "Delete evidence files" ON storage.objects FOR DELETE USING (bucket_id = 'evidence' AND auth.uid() IS NOT NULL);
