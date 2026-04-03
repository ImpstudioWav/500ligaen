import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

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

async function assertAdmin(userId: string): Promise<boolean> {
  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch {
    return false
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .maybeSingle()

  if (error || !profile) return false
  return (profile as { is_admin: boolean | null }).is_admin === true
}

function parseLeagueId(body: Record<string, unknown>): string | null {
  const raw = body.leagueId ?? body.league_id
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function POST(request: Request) {
  const userId = await getUserIdFromBearer(request)
  if (!userId) {
    return NextResponse.json({ error: 'Du må være innlogget.' }, { status: 401 })
  }

  const admin = await assertAdmin(userId)
  if (!admin) {
    return NextResponse.json({ error: 'Ingen tilgang.' }, { status: 403 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const leagueId = parseLeagueId(body)
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId mangler.' }, { status: 400 })
  }

  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch {
    return NextResponse.json({ error: 'Serveroppsett mangler (service role).' }, { status: 500 })
  }

  const { data: deleted, error } = await supabase
    .from('leagues')
    .delete()
    .eq('id', leagueId)
    .select('id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!deleted?.length) {
    return NextResponse.json({ error: 'Fant ikke ligaen.' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, leagueId })
}
