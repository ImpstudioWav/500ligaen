import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { applyMentionsAfterRegularMessage } from '@/lib/chatApplyMentions'
import { getUserIdFromBearer } from '@/lib/get-user-id-from-bearer'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

const GLOBAL_CHAT_MAX_COUNT = 300
const GLOBAL_CHAT_TRIM_COUNT = 50

/**
 * Only rows with league_id IS NULL (global chat). Never touches league messages.
 */
async function trimGlobalChatOverCap(admin: SupabaseClient): Promise<void> {
  const { count, error: countError } = await admin
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .is('league_id', null)

  if (countError) {
    throw new Error(countError.message)
  }

  if (count == null || count <= GLOBAL_CHAT_MAX_COUNT) {
    return
  }

  const { data: oldest, error: selectError } = await admin
    .from('messages')
    .select('id')
    .is('league_id', null)
    .order('created_at', { ascending: true })
    .limit(GLOBAL_CHAT_TRIM_COUNT)

  if (selectError) {
    throw new Error(selectError.message)
  }

  const ids = (oldest ?? []).map((row) => (row as { id: string }).id)
  if (ids.length === 0) {
    return
  }

  const { error: deleteError } = await admin.from('messages').delete().in('id', ids)

  if (deleteError) {
    throw new Error(deleteError.message)
  }
}

export async function POST(request: Request) {
  const userId = await getUserIdFromBearer(request)
  if (!userId) {
    return NextResponse.json({ error: 'Du må være innlogget.' }, { status: 401 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const rawContent = body.content
  if (typeof rawContent !== 'string') {
    return NextResponse.json({ error: 'content må være en tekststreng.' }, { status: 400 })
  }

  const content = rawContent.trim()
  if (!content) {
    return NextResponse.json({ error: 'Meldingen kan ikke være tom.' }, { status: 400 })
  }

  const replyToRaw = body.replyToMessageId
  const replyToMessageId =
    typeof replyToRaw === 'string' && replyToRaw.length > 0 ? replyToRaw.trim() : null

  let admin: SupabaseClient
  try {
    admin = getSupabaseAdmin()
  } catch {
    return NextResponse.json({ error: 'Serveroppsett mangler (service role).' }, { status: 500 })
  }

  if (replyToMessageId) {
    const { data: parent, error: parentErr } = await admin
      .from('messages')
      .select('id, league_id')
      .eq('id', replyToMessageId)
      .maybeSingle()

    if (parentErr || !parent) {
      return NextResponse.json(
        { error: 'Ugyldig svar: originalmeldingen finnes ikke.' },
        { status: 400 }
      )
    }
    const row = parent as { id: string; league_id: string | null }
    if (row.league_id !== null) {
      return NextResponse.json(
        { error: 'Ugyldig svar: bare globale meldinger kan svar på her.' },
        { status: 400 }
      )
    }
  }

  const { data: inserted, error: insertError } = await admin
    .from('messages')
    .insert({
      user_id: userId,
      content,
      league_id: null,
      reply_to_message_id: replyToMessageId,
    })
    .select('id, user_id, content, created_at, league_id, reply_to_message_id')
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  try {
    await trimGlobalChatOverCap(admin)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Opprydding feilet.'
    console.error('[send-global] trim failed after successful insert:', msg)
    return NextResponse.json({
      message: inserted,
      warning:
        'Meldingen ble sendt, men automatisk opprydding av gammel global chat feilet. Innholdet er lagret.',
    })
  }

  try {
    await applyMentionsAfterRegularMessage(admin, {
      messageId: (inserted as { id: string }).id,
      authorId: userId,
      content: (inserted as { content: string }).content,
      leagueId: null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Nevnelser feilet.'
    console.error('[send-global] apply mentions failed after successful insert:', msg)
    return NextResponse.json({
      message: inserted,
      warning:
        'Meldingen ble sendt, men nevnelser kunne ikke lagres. Prøv å nevne på nytt eller kontakt support.',
    })
  }

  return NextResponse.json({ message: inserted })
}
