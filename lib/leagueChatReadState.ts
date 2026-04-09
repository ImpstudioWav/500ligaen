/**
 * Client-side "last seen" per league for the chat launcher unread hints (no server table in v1).
 */
const KEY_PREFIX = '500ligaen-league-chat-read:'

/** Fired after read state updates so the nav launcher can refresh badges. */
export const LEAGUE_CHAT_READ_EVENT = '500ligaen-league-chat-read'

export function getLastReadMessageId(leagueId: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(`${KEY_PREFIX}${leagueId}`)
  } catch {
    return null
  }
}

export function setLastReadMessageId(leagueId: string, messageId: string) {
  try {
    sessionStorage.setItem(`${KEY_PREFIX}${leagueId}`, messageId)
  } catch {
    /* ignore */
  }
}

export function computeLeagueUnread(
  leagueId: string,
  latest: { id: string; user_id: string; created_at: string } | null,
  currentUserId: string | null
): boolean {
  if (!latest) return false
  if (latest.user_id === currentUserId) return false
  const read = getLastReadMessageId(leagueId)
  if (!read) return true
  return latest.id !== read
}

/** Messages must be chronological (oldest first), same as the chat query. */
export function countUnreadMessagesFromOthers(
  leagueId: string,
  messagesChronological: { id: string; user_id: string }[],
  currentUserId: string | null
): number {
  if (!currentUserId) return 0
  const readId = getLastReadMessageId(leagueId)
  if (!readId) {
    return messagesChronological.filter((m) => m.user_id !== currentUserId).length
  }
  const idx = messagesChronological.findIndex((m) => m.id === readId)
  const start = idx >= 0 ? idx + 1 : 0
  return messagesChronological.slice(start).filter((m) => m.user_id !== currentUserId).length
}
