import { supabase } from '@/lib/supabase'

type ProfileRow = {
  id: string
  username: string | null
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
