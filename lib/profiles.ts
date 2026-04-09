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
  details?: string
  hint?: string
}

/** Pick PostgREST / Supabase fields reliably (avoid logging `{}` for Error subclasses). */
export function extractSupabaseErrorFields(error: unknown): {
  message: string
  code: string
  details: string
  hint: string
} {
  const blank = { message: '', code: '', details: '', hint: '' }
  if (error == null) {
    return blank
  }
  if (typeof error === 'string') {
    return { ...blank, message: error }
  }
  if (typeof error !== 'object') {
    return { ...blank, message: String(error) }
  }

  const o = error as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')

  let message = str(o.message)
  let code = str(o.code)
  let details = str(o.details)
  let hint = str(o.hint)

  if (error instanceof Error) {
    if (!message) {
      message = error.message || ''
    }
    const anyErr = error as Error & DbErrorLike
    if (!code) code = str(anyErr.code)
    if (!details) details = str(anyErr.details)
    if (!hint) hint = str(anyErr.hint)
  }

  if (!message && o.error && typeof o.error === 'object') {
    const inner = o.error as Record<string, unknown>
    message = str(inner.message)
    if (!code) code = str(inner.code)
    if (!details) details = str(inner.details)
    if (!hint) hint = str(inner.hint)
  }

  return { message, code, details, hint }
}

/** Temporary: explicit fields + serialization when the object would otherwise print as `{}`. */
export function logUsernameSaveDebug(context: string, error: unknown) {
  const { message, code, details, hint } = extractSupabaseErrorFields(error)
  console.error(`[username-save] ${context}`, {
    message,
    code,
    details,
    hint,
  })

  if (!message && !code && !details && !hint && error !== null && typeof error === 'object') {
    console.error(`[username-save] ${context} object keys`, Object.keys(error as object))
    try {
      const names = Object.getOwnPropertyNames(error as object)
      console.error(
        `[username-save] ${context} JSON`,
        JSON.stringify(error, names)
      )
    } catch {
      console.error(`[username-save] ${context} toString`, String(error))
    }
  }

  if (error instanceof Error && error.stack) {
    console.error(`[username-save] ${context} stack`, error.stack)
  }
}

function postgresErrorText(error: unknown): string {
  const f = extractSupabaseErrorFields(error)
  return [f.message, f.details, f.hint, f.code].filter(Boolean).join(' ').toLowerCase()
}

/**
 * True when a profile row exists and has a non-empty username (trimmed).
 * Type guard: after `if (!profileHasUsername(profile)) return`, `profile` is non-null.
 */
export function profileHasUsername<P extends { username?: string | null }>(
  profile: P | null | undefined
): profile is P & { username: string } {
  const u = profile?.username?.trim()
  return profile != null && Boolean(u)
}

/** Aligns with special chat mentions @everyone / @admin (blocked case-insensitively). */
export const RESERVED_USERNAME_ERROR =
  'Dette brukernavnet er reservert og kan ikke brukes.'

/** Shown when another profile already uses this username (any casing). */
export const USERNAME_TAKEN_CI_ERROR = 'Brukernavnet er allerede tatt.'

const GENERIC_USERNAME_SAVE_ERROR = 'Kunne ikke lagre brukernavn.'

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
  const text = postgresErrorText(error)
  const code = (dbError?.code ?? '').toString()
  return (
    code === '23505' ||
    text.includes('23505') ||
    text.includes('duplicate key') ||
    text.includes('unique constraint') ||
    text.includes('already exists') ||
    text.includes('profiles_username_key') ||
    text.includes('profiles_username_lower_uidx')
  )
}

/** PostgreSQL check violation for `profiles_username_not_reserved`. */
export const isReservedUsernameConstraintError = (error: unknown) => {
  const text = postgresErrorText(error)
  return text.includes('profiles_username_not_reserved')
}

/** Map DB / client errors to a Norwegian message for username save flows. */
export function usernameSaveErrorMessage(error: unknown): string {
  logUsernameSaveDebug('usernameSaveErrorMessage', error)

  if (error instanceof Error && error.message === RESERVED_USERNAME_ERROR) {
    return RESERVED_USERNAME_ERROR
  }
  if (error instanceof Error && error.message === USERNAME_TAKEN_CI_ERROR) {
    return USERNAME_TAKEN_CI_ERROR
  }
  // Client-side validation errors we throw as Error — safe to show as-is
  if (error instanceof Error && error.message === 'Brukernavn kan ikke være tomt.') {
    return error.message
  }

  if (isReservedUsernameConstraintError(error)) {
    return RESERVED_USERNAME_ERROR
  }
  if (isUsernameTakenError(error)) {
    return USERNAME_TAKEN_CI_ERROR
  }

  const text = postgresErrorText(error)
  if (
    text.includes('profile_username_is_taken') &&
    !text.includes('does not exist') &&
    !text.includes('could not find') &&
    !text.includes('permission denied') &&
    !text.includes('not authorized')
  ) {
    return USERNAME_TAKEN_CI_ERROR
  }

  const { message } = extractSupabaseErrorFields(error)
  if (message.trim()) {
    const m = message.toLowerCase()
    if (
      m.includes('duplicate key') ||
      m.includes('unique constraint') ||
      m.includes('profiles_username_lower_uidx') ||
      m.includes('already exists')
    ) {
      return USERNAME_TAKEN_CI_ERROR
    }
    if (m.includes('profiles_username_not_reserved')) {
      return RESERVED_USERNAME_ERROR
    }
  }

  return GENERIC_USERNAME_SAVE_ERROR
}

export type CreateProfileWithUsernameResult =
  | { error: null }
  | { error: 'username_taken' }
  | { error: 'unknown' }

/**
 * Create or update the signed-in user's profile row with a username.
 * No RPC / pre-check — uniqueness is enforced by `profiles_username_lower_uidx` (23505 on conflict).
 */
export async function createProfileWithUsername(
  userId: string,
  username: string
): Promise<CreateProfileWithUsernameResult> {
  const trimmed = username.trim()
  if (!trimmed) {
    return { error: 'unknown' }
  }

  const normalized = trimmed.toLowerCase()

  const { error } = await supabase.from('profiles').upsert(
    { id: userId, username: normalized },
    { onConflict: 'id' }
  )

  if (!error) {
    return { error: null }
  }

  const fields = extractSupabaseErrorFields(error)
  console.error('[createProfileWithUsername] upsert failed', {
    message: fields.message,
    code: fields.code,
    details: fields.details,
    hint: fields.hint,
  })

  if (fields.code === '23505' || postgresErrorText(error).includes('23505')) {
    return { error: 'username_taken' }
  }

  return { error: 'unknown' }
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

  const args: { p_username: string; p_exclude_user_id?: string } = {
    p_username: trimmed,
  }
  if (excludeUserId) {
    args.p_exclude_user_id = excludeUserId
  }

  const { data, error } = await supabase.rpc('profile_username_is_taken', args)

  if (error) {
    throw error
  }

  return data === true || data === 'true'
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
