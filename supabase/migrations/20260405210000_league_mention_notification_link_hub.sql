-- League chat @mention notifications: link to league hub so the app can open the floating chat dock
-- (client handles `/league/{id}` and legacy `/league/{id}/chat`).

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
