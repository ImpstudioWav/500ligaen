-- Allow authenticated users to delete only their own rows in public.messages.
-- Prerequisite: RLS enabled on public.messages (if not, enable it and keep existing SELECT/INSERT policies).
-- Apply via Supabase CLI (`supabase db push`) or paste into the SQL Editor.
-- Safe to re-run: drops and recreates the policy by name.

DROP POLICY IF EXISTS "messages_delete_own" ON public.messages;

CREATE POLICY "messages_delete_own"
ON public.messages
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
