import type { ChatUserInfo } from '@/lib/profiles'

export type RepliedToPayload = {
  authorLabel: string
  /** Short single-line preview of the parent message (optional) */
  previewSnippet?: string
  /**
   * Which bubble visual language the quoted preview uses: matches the **parent** author
   * (`own` = viewer’s message style / dark bubble, `other` = light bubble).
   */
  quoteStyle: 'own' | 'other'
}

function truncateChatReplyPreview(text: string, maxLen = 48): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLen) return normalized
  return `${normalized.slice(0, Math.max(0, maxLen - 1))}…`
}

/**
 * Resolves reply metadata from loaded messages (parent may be missing if deleted or not loaded).
 */
export function buildRepliedToPayload(
  messages: readonly { id: string; user_id: string; content: string }[],
  replyToId: string | null | undefined,
  userInfoMap: Record<string, ChatUserInfo>,
  shortenUserId: (id: string) => string,
  viewerUserId: string | null
): RepliedToPayload | undefined {
  if (!replyToId) return undefined
  const parent = messages.find((m) => m.id === replyToId)
  if (!parent) {
    return { authorLabel: 'Ukjent', quoteStyle: 'other' }
  }
  const authorLabel =
    userInfoMap[parent.user_id]?.username?.trim() || shortenUserId(parent.user_id)
  const raw = parent.content?.trim() ?? ''
  const previewSnippet = raw ? truncateChatReplyPreview(raw) : undefined
  const quoteStyle: 'own' | 'other' =
    viewerUserId != null && parent.user_id === viewerUserId ? 'own' : 'other'
  return { authorLabel, previewSnippet, quoteStyle }
}
