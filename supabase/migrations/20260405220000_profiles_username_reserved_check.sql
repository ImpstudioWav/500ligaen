-- Block reserved mention handles at the database level (case-insensitive via lower(trim(...))).

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_not_reserved;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_not_reserved CHECK (
    username IS NULL
    OR lower(trim(username)) NOT IN ('everyone', 'admin')
  );
