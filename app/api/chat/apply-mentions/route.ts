import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  applyMentionsAfterAdminMessage,
  applyMentionsAfterRegularMessage,
} from '@/lib/chatApplyMentions'
import { getUserIdFromBearer } from '@/lib/get-user-id-from-bearer'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

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

  const messageId = typeof body.messageId === 'string' ? body.messageId : null
  const adminMessageId =
    typeof body.adminMessageId === 'string' ? body.adminMessageId : null

  if ((messageId && adminMessageId) || (!messageId && !adminMessageId)) {
    return NextResponse.json(
      { error: 'Oppgi enten messageId eller adminMessageId (ikke begge).' },
      { status: 400 }
    )
  }

  let admin: SupabaseClient
  try {
    admin = getSupabaseAdmin()
  } catch {
    return NextResponse.json({ error: 'Serveroppsett mangler (service role).' }, { status: 500 })
  }

  try {
    if (messageId) {
      const { data: msg, error: msgErr } = await admin
        .from('messages')
        .select('id, user_id, content, league_id')
        .eq('id', messageId)
        .single()

      if (msgErr || !msg) {
        return NextResponse.json({ error: 'Melding ikke funnet.' }, { status: 404 })
      }
      const row = msg as { id: string; user_id: string; content: string; league_id: string | null }
      if (row.user_id !== userId) {
        return NextResponse.json({ error: 'Ingen tilgang.' }, { status: 403 })
      }
      await applyMentionsAfterRegularMessage(admin, {
        messageId: row.id,
        authorId: userId,
        content: row.content,
        leagueId: row.league_id,
      })
      return NextResponse.json({ ok: true })
    }

    const { data: prof, error: profErr } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .single()

    if (profErr || !(prof as { is_admin?: boolean } | null)?.is_admin) {
      return NextResponse.json({ error: 'Ingen tilgang.' }, { status: 403 })
    }

    const { data: am, error: amErr } = await admin
      .from('admin_messages')
      .select('id, user_id, content')
      .eq('id', adminMessageId!)
      .single()

    if (amErr || !am) {
      return NextResponse.json({ error: 'Melding ikke funnet.' }, { status: 404 })
    }
    const adm = am as { id: string; user_id: string; content: string }
    if (adm.user_id !== userId) {
      return NextResponse.json({ error: 'Ingen tilgang.' }, { status: 403 })
    }

    await applyMentionsAfterAdminMessage(admin, {
      adminMessageId: adm.id,
      authorId: userId,
      content: adm.content,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ukjent feil.'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
