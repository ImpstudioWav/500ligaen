-- Case-insensitive unique usernames: index on lower(trim(username)), dedupe existing rows, RPC for availability under RLS.

-- 1) Resolve existing duplicates (same name ignoring case): keep one row per normalized form, rename others.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY lower(trim(username))
      ORDER BY id
    ) AS rn
  FROM public.profiles
  WHERE username IS NOT NULL
    AND trim(username) <> ''
)
UPDATE public.profiles p
SET username = left(trim(p.username), 18) || '_' || left(replace(gen_random_uuid()::text, '-', ''), 8)
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1;

-- 2) Drop old case-sensitive unique constraint on username (Supabase/Postgres default name).
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_username_key;

-- 3) Functional unique index (NULL / empty usernames excluded; multiple NULL usernames allowed).
DROP INDEX IF EXISTS public.profiles_username_lower_uidx;
CREATE UNIQUE INDEX profiles_username_lower_uidx
  ON public.profiles (lower(trim(username)))
  WHERE username IS NOT NULL
    AND trim(username) <> '';

-- 4) Existence check bypassing RLS so clients can validate before insert/update.
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
      AND (p_exclude_user_id IS NULL OR p.id <> p_exclude_user_id)
  );
$$;

REVOKE ALL ON FUNCTION public.profile_username_is_taken(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_username_is_taken(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.profile_username_is_taken(text, uuid) TO anon;
