import { supabase } from '@/lib/supabase'

type ProfileRow = {
  id: string
  username: string | null
  is_admin?: boolean | null
  created_at?: string
}

type DbErrorLike = {
  code?: string
  message?: string
}

/** Aligns with special chat mentions @everyone / @admin (blocked case-insensitively). */
export const RESERVED_USERNAME_ERROR =
  'Dette brukernavnet er reservert og kan ikke brukes.'

/** Shown when another profile already uses this username (any casing). */
export const USERNAME_TAKEN_CI_ERROR =
  'Dette brukernavnet er allerede i bruk (uavhengig av store og små bokstaver).'

const RESERVED_USERNAMES_LOWER = new Set(['everyone', 'admin'])

/** True if trimmed username equals a reserved mention keyword (case-insensitive). */
export function isReservedUsername(username: string): boolean {
  const key = username.trim().toLowerCase()
  return RESERVED_USERNAMES_LOWER.has(key)
}

export const shortenUserId = (userId: string) => {
  if (userId.length <= 12) return userId
  return `${userId.slice(0, 8)}...${userId.slice(-4)}`
}

export const createDefaultUsername = (userId: string) => {
  const suffix = userId.replace(/-/g, '').slice(0, 4).toLowerCase()
  return `user-${suffix}`
}

async function pickUniqueDefaultUsername(userId: string): Promise<string> {
  const base = `user-${userId.replace(/-/g, '').slice(0, 8).toLowerCase()}`
  let candidate = createDefaultUsername(userId)
  let n = 0
  while (await isUsernameTaken(candidate, userId)) {
    n += 1
    candidate = `${base}${n}`
    if (n > 200) {
      candidate = `user-${userId.replace(/-/g, '').toLowerCase()}${n}`
    }
  }
  return candidate
}

export const ensureProfileForUser = async (userId: string) => {
  const { data: existingProfile, error: fetchError } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('id', userId)
    .maybeSingle<ProfileRow>()

  if (fetchError) {
    throw fetchError
  }

  if (existingProfile?.username) {
    return existingProfile.username
  }

  const generatedUsername = await pickUniqueDefaultUsername(userId)

  const { error: upsertError } = await supabase.from('profiles').upsert(
    {
      id: userId,
      username: generatedUsername,
    },
    { onConflict: 'id' }
  )

  if (upsertError) {
    throw upsertError
  }

  return generatedUsername
}

export const isUsernameTakenError = (error: unknown) => {
  const dbError = error as DbErrorLike
  const m = dbError?.message?.toLowerCase() ?? ''
  return (
    dbError?.code === '23505' ||
    m.includes('duplicate key') ||
    m.includes('profiles_username_key') ||
    m.includes('profiles_username_lower_uidx')
  )
}

/** PostgreSQL check violation for `profiles_username_not_reserved`. */
export const isReservedUsernameConstraintError = (error: unknown) => {
  const dbError = error as DbErrorLike
  const m = dbError?.message?.toLowerCase() ?? ''
  return (
    dbError?.code === '23514' && m.includes('profiles_username_not_reserved')
  )
}

export const createProfileWithUsername = async (userId: string, username: string) => {
  const trimmed = username.trim()
  if (!trimmed) {
    throw new Error('Brukernavn kan ikke være tomt.')
  }
  if (isReservedUsername(trimmed)) {
    throw new Error(RESERVED_USERNAME_ERROR)
  }
  const taken = await isUsernameTaken(trimmed, null)
  if (taken) {
    throw new Error(USERNAME_TAKEN_CI_ERROR)
  }

  const { error } = await supabase.from('profiles').upsert(
    {
      id: userId,
      username: trimmed,
    },
    { onConflict: 'id' }
  )

  if (error) {
    throw error
  }

  return trimmed
}

export const getProfileByUserId = async (userId: string) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, is_admin, created_at')
    .eq('id', userId)
    .maybeSingle<ProfileRow>()

  if (error) {
    throw error
  }

  return data
}

/**
 * True if another profile already uses this username (case-insensitive), optionally excluding one user id
 * (e.g. current user while editing). Uses DB RPC (SECURITY DEFINER) so RLS does not hide other rows.
 */
export async function isUsernameTaken(
  username: string,
  excludeUserId: string | null
): Promise<boolean> {
  const trimmed = username.trim()
  if (!trimmed) return true
  const { data, error } = await supabase.rpc('profile_username_is_taken', {
    p_username: trimmed,
    p_exclude_user_id: excludeUserId,
  })

  if (error) {
    throw error
  }

  return data === true
}

/** Inverse of {@link isUsernameTaken}; false for reserved or empty handles. */
export const isUsernameAvailable = async (
  username: string,
  excludeUserId?: string | null
) => {
  const trimmed = username.trim()
  if (!trimmed || isReservedUsername(trimmed)) {
    return false
  }
  return !(await isUsernameTaken(trimmed, excludeUserId ?? null))
}

/** Display fields for chat and lists; from `profiles` (username + is_admin). */
export type ChatUserInfo = {
  username: string
  isAdmin: boolean
}

export const getUsernameMap = async (
  userIds: string[]
): Promise<Record<string, ChatUserInfo>> => {
  if (userIds.length === 0) return {}

  const uniqueUserIds = Array.from(new Set(userIds))
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, is_admin')
    .in('id', uniqueUserIds)

  if (error) {
    throw error
  }

  const map: Record<string, ChatUserInfo> = {}
  for (const profile of (data ?? []) as ProfileRow[]) {
    map[profile.id] = {
      username: profile.username?.trim() || shortenUserId(profile.id),
      isAdmin: profile.is_admin === true,
    }
  }

  return map
}
