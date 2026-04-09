-- Extend message_mentions for global messages (same `messages` row, league_id NULL) and admin_messages.
-- Adds nullable message_id + admin_message_id with exactly one set per row.

ALTER TABLE public.message_mentions DROP CONSTRAINT IF EXISTS message_mentions_message_id_mentioned_user_id_key;

ALTER TABLE public.message_mentions
  ALTER COLUMN message_id DROP NOT NULL;

ALTER TABLE public.message_mentions
  ADD COLUMN IF NOT EXISTS admin_message_id uuid REFERENCES public.admin_messages (id) ON DELETE CASCADE;

ALTER TABLE public.message_mentions DROP CONSTRAINT IF EXISTS message_mentions_target_chk;
ALTER TABLE public.message_mentions
  ADD CONSTRAINT message_mentions_target_chk CHECK (
    (message_id IS NOT NULL AND admin_message_id IS NULL)
    OR (message_id IS NULL AND admin_message_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS message_mentions_msg_user_idx
  ON public.message_mentions (message_id, mentioned_user_id)
  WHERE admin_message_id IS NULL AND message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS message_mentions_admin_msg_user_idx
  ON public.message_mentions (admin_message_id, mentioned_user_id)
  WHERE message_id IS NULL AND admin_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS message_mentions_admin_message_id_idx ON public.message_mentions (admin_message_id);

-- RLS: replace league-only policies with league + global + admin

ALTER TABLE public.message_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "message_mentions_select_league_members" ON public.message_mentions;
DROP POLICY IF EXISTS "message_mentions_insert_message_author_to_league_member" ON public.message_mentions;

CREATE POLICY "message_mentions_select_league"
ON public.message_mentions
FOR SELECT
TO authenticated
USING (
  message_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.messages m
    INNER JOIN public.league_members lm ON lm.league_id = m.league_id AND lm.user_id = auth.uid()
    WHERE m.id = message_mentions.message_id
      AND m.league_id IS NOT NULL
  )
);

CREATE POLICY "message_mentions_select_global"
ON public.message_mentions
FOR SELECT
TO authenticated
USING (
  message_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.messages m
    WHERE m.id = message_mentions.message_id
      AND m.league_id IS NULL
  )
);

CREATE POLICY "message_mentions_select_admin_chat"
ON public.message_mentions
FOR SELECT
TO authenticated
USING (
  admin_message_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_admin = true
  )
);

CREATE POLICY "message_mentions_insert_league_author"
ON public.message_mentions
FOR INSERT
TO authenticated
WITH CHECK (
  message_id IS NOT NULL
  AND admin_message_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.messages m
    WHERE m.id = message_mentions.message_id
      AND m.user_id = auth.uid()
      AND m.league_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.league_members lm
        WHERE lm.league_id = m.league_id
          AND lm.user_id = message_mentions.mentioned_user_id
      )
  )
);

CREATE POLICY "message_mentions_insert_global_author"
ON public.message_mentions
FOR INSERT
TO authenticated
WITH CHECK (
  message_id IS NOT NULL
  AND admin_message_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.messages m
    WHERE m.id = message_mentions.message_id
      AND m.user_id = auth.uid()
      AND m.league_id IS NULL
  )
);

CREATE POLICY "message_mentions_insert_admin_author"
ON public.message_mentions
FOR INSERT
TO authenticated
WITH CHECK (
  admin_message_id IS NOT NULL
  AND message_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.admin_messages am
    WHERE am.id = message_mentions.admin_message_id
      AND am.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = message_mentions.mentioned_user_id
      AND p.is_admin = true
  )
);

-- Let signed-in users read profiles for @mention suggestions in global chat (id + username only via select in app).
DROP POLICY IF EXISTS "profiles_select_usernames_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_usernames_authenticated"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);
