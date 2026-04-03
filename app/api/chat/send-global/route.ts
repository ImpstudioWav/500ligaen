import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

const GLOBAL_CHAT_MAX_COUNT = 300
const GLOBAL_CHAT_TRIM_COUNT = 50

async function getUserIdFromBearer(request: Request): Promise<string | null> {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  if (!token) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  const authClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser()
  if (error || !user) return null
  return user.id
}

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

  let admin: SupabaseClient
  try {
    admin = getSupabaseAdmin()
  } catch {
    return NextResponse.json({ error: 'Serveroppsett mangler (service role).' }, { status: 500 })
  }

  const { data: inserted, error: insertError } = await admin
    .from('messages')
    .insert({
      user_id: userId,
      content,
      league_id: null,
    })
    .select('id, user_id, content, created_at, league_id')
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

  return NextResponse.json({ message: inserted })
}
