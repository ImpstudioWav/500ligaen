-- Fix false "username taken" when p_exclude_user_id is omitted or null in the RPC payload
-- (PostgREST/clients often omit or strip null args). Fall back to auth.uid() so the caller's
-- own profile row is always excluded for signed-in users.

CREATE OR REPLACE FUNCTION public.profile_username_is_taken(
  p_username text,
  p_exclude_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.username IS NOT NULL
      AND trim(p.username) <> ''
      AND lower(trim(p.username)) = lower(trim(p_username))
      AND (
        COALESCE(p_exclude_user_id, auth.uid()) IS NULL
        OR p.id <> COALESCE(p_exclude_user_id, auth.uid())
      )
  );
$$;
