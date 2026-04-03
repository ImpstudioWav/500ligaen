-- =============================================================================
-- Admin-only chat: public.admin_messages
-- Run this entire file in the Supabase SQL Editor (or via `supabase db push`).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.admin_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_messages_content_not_blank CHECK (length(trim(content)) > 0)
);

CREATE INDEX IF NOT EXISTS admin_messages_created_at_idx ON public.admin_messages (created_at);

ALTER TABLE public.admin_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_messages_select_admins" ON public.admin_messages;
DROP POLICY IF EXISTS "admin_messages_insert_admins" ON public.admin_messages;
DROP POLICY IF EXISTS "admin_messages_delete_own" ON public.admin_messages;

-- Read: only rows in admin_messages if the current user is an admin (profiles.is_admin).
CREATE POLICY "admin_messages_select_admins"
ON public.admin_messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_admin = true
  )
);

-- Insert: only admins, and only as themselves (user_id must match JWT).
CREATE POLICY "admin_messages_insert_admins"
ON public.admin_messages
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT auth.uid()) = user_id
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_admin = true
  )
);

-- Delete: admins may delete only their own rows.
CREATE POLICY "admin_messages_delete_own"
ON public.admin_messages
FOR DELETE
TO authenticated
USING (
  (SELECT auth.uid()) = user_id
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_admin = true
  )
);

GRANT SELECT, INSERT, DELETE ON public.admin_messages TO authenticated;

-- -----------------------------------------------------------------------------
-- Realtime (required for live updates in the app):
-- In Dashboard: Database → Replication → enable for `admin_messages`,
-- or run (as a role allowed to modify the publication):
--
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_messages;
-- -----------------------------------------------------------------------------
