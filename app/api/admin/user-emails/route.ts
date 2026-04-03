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

const LIST_PER_PAGE = 200
const MAX_PAGES = 50

/**
 * Admin-only: returns auth user ids mapped to primary email (from auth.users via service role).
 */
export async function GET(request: Request) {
  const userId = await getUserIdFromBearer(request)
  if (!userId) {
    return NextResponse.json({ error: 'Du må være innlogget.' }, { status: 401 })
  }

  let admin
  try {
    admin = getSupabaseAdmin()
  } catch {
    return NextResponse.json({ error: 'Serveroppsett mangler (service role).' }, { status: 500 })
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .maybeSingle()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Ingen tilgang.' }, { status: 403 })
  }

  if ((profile as { is_admin: boolean | null }).is_admin !== true) {
    return NextResponse.json({ error: 'Ingen tilgang.' }, { status: 403 })
  }

  const emailsById: Record<string, string> = {}

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: LIST_PER_PAGE,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const users = data?.users ?? []
    for (const u of users) {
      if (u.id && typeof u.email === 'string' && u.email.trim()) {
        emailsById[u.id] = u.email.trim()
      }
    }

    if (users.length < LIST_PER_PAGE) {
      break
    }
  }

  return NextResponse.json({ emailsById })
}
