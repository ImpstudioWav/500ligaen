-- League chat @mentions: store who was mentioned per message (content stays plain text).

CREATE TABLE IF NOT EXISTS public.message_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages (id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS message_mentions_message_id_idx ON public.message_mentions (message_id);
CREATE INDEX IF NOT EXISTS message_mentions_mentioned_user_id_idx ON public.message_mentions (mentioned_user_id);

ALTER TABLE public.message_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "message_mentions_select_league_members" ON public.message_mentions;
CREATE POLICY "message_mentions_select_league_members"
ON public.message_mentions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.messages m
    INNER JOIN public.league_members lm ON lm.league_id = m.league_id AND lm.user_id = auth.uid()
    WHERE m.id = message_mentions.message_id
  )
);

DROP POLICY IF EXISTS "message_mentions_insert_message_author_to_league_member" ON public.message_mentions;
CREATE POLICY "message_mentions_insert_message_author_to_league_member"
ON public.message_mentions
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
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

GRANT SELECT, INSERT ON public.message_mentions TO authenticated;
