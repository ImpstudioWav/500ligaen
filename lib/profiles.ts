import { supabase } from '@/lib/supabase'

type ProfileRow = {
  id: string
  username: string | null
  created_at?: string
}

type DbErrorLike = {
  code?: string
  message?: string
}

export const shortenUserId = (userId: string) => {
  if (userId.length <= 12) return userId
  return `${userId.slice(0, 8)}...${userId.slice(-4)}`
}

export const createDefaultUsername = (userId: string) => {
  const suffix = userId.replace(/-/g, '').slice(0, 4).toLowerCase()
  return `user-${suffix}`
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

  const generatedUsername = createDefaultUsername(userId)

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
  return (
    dbError?.code === '23505' ||
    dbError?.message?.toLowerCase().includes('duplicate key') ||
    dbError?.message?.toLowerCase().includes('profiles_username_key')
  )
}

export const createProfileWithUsername = async (userId: string, username: string) => {
  const cleanedUsername = username.trim().toLowerCase()

  const { error } = await supabase.from('profiles').upsert(
    {
      id: userId,
      username: cleanedUsername,
    },
    { onConflict: 'id' }
  )

  if (error) {
    throw error
  }

  return cleanedUsername
}

export const getProfileByUserId = async (userId: string) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, created_at')
    .eq('id', userId)
    .maybeSingle<ProfileRow>()

  if (error) {
    throw error
  }

  return data
}

export const isUsernameAvailable = async (username: string) => {
  const cleanedUsername = username.trim().toLowerCase()
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', cleanedUsername)
    .maybeSingle()

  if (error) {
    throw error
  }

  return !data
}

export const getUsernameMap = async (userIds: string[]) => {
  if (userIds.length === 0) return {} as Record<string, string>

  const uniqueUserIds = Array.from(new Set(userIds))
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username')
    .in('id', uniqueUserIds)

  if (error) {
    throw error
  }

  const map: Record<string, string> = {}
  for (const profile of (data ?? []) as ProfileRow[]) {
    if (profile.username) {
      map[profile.id] = profile.username
    }
  }

  return map
}
