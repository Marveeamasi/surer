
-- Storage bucket for evidence (using extensions)
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA extensions;

-- Since storage.buckets isn't available in migrations, we'll handle evidence URLs directly
-- Evidence images will be stored as external URLs or via edge function uploads
