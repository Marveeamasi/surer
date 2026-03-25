SELECT id, email FROM auth.users WHERE email = 'your@email.com';

INSERT INTO public.user_roles (user_id, role)
VALUES ('<paste-your-uuid-here>', 'admin');



