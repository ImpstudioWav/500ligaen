import type { SupabaseClient } from '@supabase/supabase-js'
import { parseMentionedUsernames } from '@/lib/leagueMentions'

const PAGE = 1000
/** PostgREST `.in()` payloads are capped; stay well under typical limits. */
const PROFILE_IN_CHUNK = 200

export async function fetchAdminProfileIds(admin: SupabaseClient): Promise<string[]> {
  const ids: string[] = []
  let from = 0
  while (true) {
    const { data, error } = await admin
      .from('profiles')
      .select('id')
      .eq('is_admin', true)
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { id: string }[]
    for (const r of rows) ids.push(r.id)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return ids
}

async function fetchLeagueMemberUserIds(
  admin: SupabaseClient,
  leagueId: string
): Promise<string[]> {
  const ids: string[] = []
  let from = 0
  while (true) {
    const { data, error } = await admin
      .from('league_members')
      .select('user_id')
      .eq('league_id', leagueId)
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { user_id: string }[]
    for (const r of rows) ids.push(r.user_id)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return ids
}

async function fetchProfilesUsernameByUserIds(
  admin: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (userIds.length === 0) return map

  for (let i = 0; i < userIds.length; i += PROFILE_IN_CHUNK) {
    const chunk = userIds.slice(i, i + PROFILE_IN_CHUNK)
    const { data, error } = await admin
      .from('profiles')
      .select('id, username')
      .in('id', chunk)

    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { id: string; username: string | null }[]
    for (const r of rows) {
      map.set(r.id, r.username)
    }
  }
  return map
}

/** League members for mention resolution: no embedded join (schema cache may lack league_members → profiles). */
async function fetchLeagueMemberRows(
  admin: SupabaseClient,
  leagueId: string
): Promise<{ user_id: string; username: string | null }[]> {
  const userIds = await fetchLeagueMemberUserIds(admin, leagueId)
  const usernameById = await fetchProfilesUsernameByUserIds(admin, userIds)
  return userIds.map((user_id) => ({
    user_id,
    username: usernameById.get(user_id) ?? null,
  }))
}

function normalizeUsernameKey(raw: string | null | undefined): string | null {
  const u = raw?.trim().toLowerCase()
  return u && u.length > 0 ? u : null
}

/**
 * Trusted resolution: parse @everyone / @admin / @username from content, merge targets, exclude author.
 * Duplicate notifications are avoided by a single Set of user ids before insert; DB UNIQUE(message_id, mentioned_user_id) is a backstop.
 */
export async function computeMentionTargetUserIds(
  admin: SupabaseClient,
  params: {
    content: string
    authorId: string
    kind: 'league' | 'global' | 'admin'
    leagueId: string | null
  }
): Promise<string[]> {
  const handles = parseMentionedUsernames(params.content)
  const includeEveryone = handles.includes('everyone')
  const includeAdminMention = handles.includes('admin')
  const usernameHandles = handles.filter((h) => h !== 'everyone' && h !== 'admin')

  const targets = new Set<string>()

  if (params.kind === 'league') {
    if (!params.leagueId) {
      throw new Error('leagueId required for league mentions')
    }
    const memberRows = await fetchLeagueMemberRows(admin, params.leagueId)
    const usernameToMemberId = new Map<string, string>()
    const memberIds = new Set<string>()
    for (const r of memberRows) {
      memberIds.add(r.user_id)
      const key = normalizeUsernameKey(r.username)
      if (key) usernameToMemberId.set(key, r.user_id)
    }
    for (const h of usernameHandles) {
      const id = usernameToMemberId.get(h)
      if (id) targets.add(id)
    }
    if (includeEveryone) {
      for (const id of memberIds) targets.add(id)
    }
    if (includeAdminMention) {
      for (const id of await fetchAdminProfileIds(admin)) targets.add(id)
    }
  } else if (params.kind === 'global') {
    if (includeAdminMention) {
      for (const id of await fetchAdminProfileIds(admin)) targets.add(id)
    }
    const wantedNames = new Set(usernameHandles)
    const matchedNames = new Set<string>()

    if (includeEveryone || usernameHandles.length > 0) {
      let from = 0
      while (true) {
        const { data, error } = await admin
          .from('profiles')
          .select('id, username')
          .range(from, from + PAGE - 1)

        if (error) throw new Error(error.message)
        const rows = (data ?? []) as { id: string; username: string | null }[]
        for (const row of rows) {
          if (includeEveryone) targets.add(row.id)
          const key = normalizeUsernameKey(row.username)
          if (key && wantedNames.has(key)) {
            targets.add(row.id)
            matchedNames.add(key)
          }
        }
        const allNamesFound =
          usernameHandles.length === 0 || matchedNames.size >= wantedNames.size
        if (!includeEveryone && allNamesFound) break
        if (rows.length < PAGE) break
        from += PAGE
      }
    }
  } else {
    if (includeEveryone || includeAdminMention) {
      for (const id of await fetchAdminProfileIds(admin)) targets.add(id)
    }
    const wantedNames = new Set(usernameHandles)
    const matchedNames = new Set<string>()
    if (usernameHandles.length > 0) {
      let from = 0
      while (true) {
        const { data, error } = await admin
          .from('profiles')
          .select('id, username')
          .eq('is_admin', true)
          .range(from, from + PAGE - 1)

        if (error) throw new Error(error.message)
        const rows = (data ?? []) as { id: string; username: string | null }[]
        for (const row of rows) {
          const key = normalizeUsernameKey(row.username)
          if (key && wantedNames.has(key)) {
            targets.add(row.id)
            matchedNames.add(key)
          }
        }
        if (matchedNames.size >= wantedNames.size || rows.length < PAGE) break
        from += PAGE
      }
    }
  }

  targets.delete(params.authorId)
  return [...targets]
}

export async function insertMentionsForRegularMessage(
  admin: SupabaseClient,
  messageId: string,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) return
  const chunk = 500
  for (let i = 0; i < userIds.length; i += chunk) {
    const slice = userIds.slice(i, i + chunk)
    const { error } = await admin.from('message_mentions').insert(
      slice.map((mentioned_user_id) => ({ message_id: messageId, mentioned_user_id }))
    )
    if (error) throw new Error(error.message)
  }
}

export async function insertMentionsForAdminMessage(
  admin: SupabaseClient,
  adminMessageId: string,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) return
  const chunk = 500
  for (let i = 0; i < userIds.length; i += chunk) {
    const slice = userIds.slice(i, i + chunk)
    const { error } = await admin.from('message_mentions').insert(
      slice.map((mentioned_user_id) => ({
        admin_message_id: adminMessageId,
        mentioned_user_id,
      }))
    )
    if (error) throw new Error(error.message)
  }
}

export async function applyMentionsAfterRegularMessage(
  admin: SupabaseClient,
  args: {
    messageId: string
    authorId: string
    content: string
    leagueId: string | null
  }
): Promise<void> {
  if (!args.content.includes('@')) return
  const kind = args.leagueId ? 'league' : 'global'
  const ids = await computeMentionTargetUserIds(admin, {
    content: args.content,
    authorId: args.authorId,
    kind,
    leagueId: args.leagueId,
  })
  await insertMentionsForRegularMessage(admin, args.messageId, ids)
}

export async function applyMentionsAfterAdminMessage(
  admin: SupabaseClient,
  args: {
    adminMessageId: string
    authorId: string
    content: string
  }
): Promise<void> {
  if (!args.content.includes('@')) return
  const ids = await computeMentionTargetUserIds(admin, {
    content: args.content,
    authorId: args.authorId,
    kind: 'admin',
    leagueId: null,
  })
  await insertMentionsForAdminMessage(admin, args.adminMessageId, ids)
}
