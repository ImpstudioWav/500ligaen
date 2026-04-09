/**
 * Chat @mentions: parse plain-text content and resolve usernames to user ids.
 * Usernames are matched case-insensitively against a caller-supplied map (league / global / admin).
 *
 * Handles `everyone` and `admin` are special tokens (see SPECIAL_MENTION_*): they appear in
 * parseMentionedUsernames() and are expanded on the server in chatApplyMentions.ts.
 */

export const SPECIAL_MENTION_EVERYONE = 'everyone'
export const SPECIAL_MENTION_ADMIN = 'admin'

export type MentionUserRow = { userId: string; username: string }

/** Lowercase username → user id (last wins on duplicate keys). */
export function buildUsernameKeyToUserIdMap(rows: MentionUserRow[]): Record<string, string> {
  const m: Record<string, string> = {}
  for (const r of rows) {
    m[r.username.trim().toLowerCase()] = r.userId
  }
  return m
}

/** Match @handle where handle is word chars; @ must be at start or after whitespace. */
const MENTION_REGEX = /(?:^|[\s])@([a-zA-Z0-9_-]+)/g

export function parseMentionedUsernames(text: string): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(MENTION_REGEX.source, 'g')
  while ((m = re.exec(text)) !== null) {
    const name = m[1].toLowerCase()
    if (!seen.has(name)) {
      seen.add(name)
      ordered.push(name)
    }
  }
  return ordered
}

export function resolveMentionedUserIds(
  text: string,
  usernameToUserId: Map<string, string>
): string[] {
  const names = parseMentionedUsernames(text)
  const ids: string[] = []
  const seenId = new Set<string>()
  for (const name of names) {
    const id = usernameToUserId.get(name)
    if (id && !seenId.has(id)) {
      seenId.add(id)
      ids.push(id)
    }
  }
  return ids
}

export type ActiveMentionState = { atIndex: number; query: string }

/**
 * If the caret is immediately after an in-progress @mention (no space in the handle), returns its start index and query.
 */
export function getActiveMentionState(text: string, cursor: number): ActiveMentionState | null {
  const len = text.length
  let pos = Math.min(Math.max(0, cursor), len)

  // Some browsers report selectionStart as 0 briefly while value is "@" (caret should be after @).
  if (text === '@' && pos === 0) {
    pos = 1
  }

  let i = pos - 1
  while (i >= 0 && text[i] !== '@') {
    if (/\s/.test(text[i])) return null
    i--
  }
  if (i < 0 || text[i] !== '@') return null
  if (i > 0 && !/\s/.test(text[i - 1])) return null
  const query = text.slice(i + 1, pos)
  if (/\s/.test(query)) return null
  return { atIndex: i, query }
}
