-- Notifications for @mentions: one row per message_mentions insert (deduped by UNIQUE on mentions).
-- Skips notifying the message author when they mention themselves.
-- Implemented as SECURITY DEFINER trigger (no app/API changes required).

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  link text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_created_at_idx
  ON public.notifications (user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
ON public.notifications
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
ON public.notifications
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

GRANT SELECT, UPDATE ON public.notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_chat_mention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  author_id uuid;
  league uuid;
  ctx text;
  link_url text;
  sender_name text;
BEGIN
  IF NEW.mentioned_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.message_id IS NOT NULL THEN
    SELECT m.user_id, m.league_id INTO author_id, league
    FROM public.messages m
    WHERE m.id = NEW.message_id;

    IF author_id IS NULL THEN
      RETURN NEW;
    END IF;

    IF NEW.mentioned_user_id = author_id THEN
      RETURN NEW;
    END IF;

    IF league IS NULL THEN
      ctx := 'global';
      link_url := '/chat';
    ELSE
      ctx := 'league';
      link_url := '/league/' || league::text || '/chat';
    END IF;

  ELSIF NEW.admin_message_id IS NOT NULL THEN
    SELECT am.user_id INTO author_id
    FROM public.admin_messages am
    WHERE am.id = NEW.admin_message_id;

    IF author_id IS NULL THEN
      RETURN NEW;
    END IF;

    IF NEW.mentioned_user_id = author_id THEN
      RETURN NEW;
    END IF;

    ctx := 'admin';
    link_url := '/admin';

  ELSE
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(TRIM(p.username), ''), SUBSTRING(author_id::text, 1, 8))
  INTO sender_name
  FROM public.profiles p
  WHERE p.id = author_id;

  IF sender_name IS NULL THEN
    sender_name := 'Noen';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link, is_read)
  VALUES (
    NEW.mentioned_user_id,
    'chat_mention',
    'Du ble nevnt i en chat',
    CASE ctx
      WHEN 'global' THEN sender_name || ' nevnte deg i global chat.'
      WHEN 'league' THEN sender_name || ' nevnte deg i en ligachat.'
      WHEN 'admin' THEN sender_name || ' nevnte deg i admin-chat.'
      ELSE sender_name || ' nevnte deg i chat.'
    END,
    link_url,
    false
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_message_mentions_notify ON public.message_mentions;

CREATE TRIGGER trg_message_mentions_notify
AFTER INSERT ON public.message_mentions
FOR EACH ROW
EXECUTE PROCEDURE public.notify_chat_mention();
