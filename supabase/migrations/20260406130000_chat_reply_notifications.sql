-- Reply threading + notifications (type chat_reply), deduped with @mentions per (user_id, triggering message id).

-- 1) Optional link to parent message (same channel only; enforced below)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id uuid REFERENCES public.messages (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_reply_to_message_id_idx ON public.messages (reply_to_message_id);

-- 2) Admin chat replies
ALTER TABLE public.admin_messages
  ADD COLUMN IF NOT EXISTS reply_to_admin_message_id uuid REFERENCES public.admin_messages (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS admin_messages_reply_to_idx ON public.admin_messages (reply_to_admin_message_id);

-- 3) Dedupe: one notification per recipient per "source" chat row (reply + mention share the new message id)
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_message_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedupe_message_uidx
  ON public.notifications (user_id, dedupe_message_id)
  WHERE dedupe_message_id IS NOT NULL;

-- 4) Validate league/global reply context
CREATE OR REPLACE FUNCTION public.messages_validate_reply_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_league uuid;
BEGIN
  IF NEW.reply_to_message_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT m.league_id INTO parent_league
  FROM public.messages m
  WHERE m.id = NEW.reply_to_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ugyldig svar: originalmeldingen finnes ikke';
  END IF;

  IF NEW.league_id IS DISTINCT FROM parent_league THEN
    RAISE EXCEPTION 'Svar må være i samme chat som originalmeldingen';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_validate_reply ON public.messages;
CREATE TRIGGER trg_messages_validate_reply
BEFORE INSERT OR UPDATE OF reply_to_message_id, league_id
ON public.messages
FOR EACH ROW
EXECUTE PROCEDURE public.messages_validate_reply_context();

-- 5) Validate admin reply parent exists
CREATE OR REPLACE FUNCTION public.admin_messages_validate_reply()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.reply_to_admin_message_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_messages am WHERE am.id = NEW.reply_to_admin_message_id
  ) THEN
    RAISE EXCEPTION 'Ugyldig svar: originalmeldingen finnes ikke';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_messages_validate_reply ON public.admin_messages;
CREATE TRIGGER trg_admin_messages_validate_reply
BEFORE INSERT OR UPDATE OF reply_to_admin_message_id
ON public.admin_messages
FOR EACH ROW
EXECUTE PROCEDURE public.admin_messages_validate_reply();

-- 6) Notify original author on reply (messages / global + league)
CREATE OR REPLACE FUNCTION public.notify_chat_reply_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_author uuid;
  parent_league uuid;
  link_url text;
  body_text text;
BEGIN
  IF NEW.reply_to_message_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT m.user_id, m.league_id INTO parent_author, parent_league
  FROM public.messages m
  WHERE m.id = NEW.reply_to_message_id;

  IF parent_author IS NULL THEN
    RETURN NEW;
  END IF;

  IF parent_author = NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.league_id IS DISTINCT FROM parent_league THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = parent_author
      AND n.dedupe_message_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  IF parent_league IS NULL THEN
    link_url := '/chat';
    body_text := 'Noen svarte deg i global chat.';
  ELSE
    link_url := '/league/' || parent_league::text;
    body_text := 'Noen svarte deg i en ligachat.';
  END IF;

  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, link, is_read, dedupe_message_id)
    VALUES (
      parent_author,
      'chat_reply',
      'Noen svarte på meldingen din',
      body_text,
      link_url,
      false,
      NEW.id
    );
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_chat_reply_notify ON public.messages;
CREATE TRIGGER trg_messages_chat_reply_notify
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE PROCEDURE public.notify_chat_reply_message();

-- 7) Admin chat reply notification
CREATE OR REPLACE FUNCTION public.notify_chat_reply_admin_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_author uuid;
BEGIN
  IF NEW.reply_to_admin_message_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT am.user_id INTO parent_author
  FROM public.admin_messages am
  WHERE am.id = NEW.reply_to_admin_message_id;

  IF parent_author IS NULL THEN
    RETURN NEW;
  END IF;

  IF parent_author = NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = parent_author
      AND n.dedupe_message_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, link, is_read, dedupe_message_id)
    VALUES (
      parent_author,
      'chat_reply',
      'Noen svarte på meldingen din',
      'Noen svarte deg i admin-chat.',
      '/admin',
      false,
      NEW.id
    );
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_messages_chat_reply_notify ON public.admin_messages;
CREATE TRIGGER trg_admin_messages_chat_reply_notify
AFTER INSERT ON public.admin_messages
FOR EACH ROW
EXECUTE PROCEDURE public.notify_chat_reply_admin_message();

-- 8) Mention notifications: same dedupe_message_id; skip if reply already notified this user
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
  dedupe_id uuid;
BEGIN
  IF NEW.mentioned_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  dedupe_id := COALESCE(NEW.message_id, NEW.admin_message_id);

  IF dedupe_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = NEW.mentioned_user_id
      AND n.dedupe_message_id = dedupe_id
  ) THEN
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
      link_url := '/league/' || league::text;
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

  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, link, is_read, dedupe_message_id)
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
      false,
      dedupe_id
    );
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;
