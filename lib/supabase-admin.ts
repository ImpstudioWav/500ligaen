import { createClient, SupabaseClient } from '@supabase/supabase-js'

let adminClient: SupabaseClient | null = null

/**
 * Server-only client with service role key (bypasses RLS).
 * Required for batch score_details + leaderboard updates.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) {
    return adminClient
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add SUPABASE_SERVICE_ROLE_KEY to .env.local for score recalculation.'
    )
  }

  adminClient = createClient(url, serviceKey)
  return adminClient
}
