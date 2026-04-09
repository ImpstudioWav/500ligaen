'use client'

import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ChatMessageBubble } from '@/components/chat/ChatMessageBubble'
import { ChatMentionTextField } from '@/components/chat/ChatMentionTextField'
import { buildUsernameKeyToUserIdMap } from '@/lib/leagueMentions'
import {
  type ChatUserInfo,
  getProfileByUserId,
  getUsernameMap,
  shortenUserId,
} from '@/lib/profiles'
import { buildRepliedToPayload } from '@/lib/chatReplyPreview'

type AdminMessage = {
  id: string
  user_id: string
  content: string
  created_at: string
  reply_to_admin_message_id?: string | null
}

const CHANNEL_NAME = 'admin-messages-internal'

function removeAdminChatChannel() {
  const topic = `realtime:${CHANNEL_NAME}`
  for (const ch of supabase.getChannels()) {
    if (ch.topic === topic) {
      void supabase.removeChannel(ch)
    }
  }
}

type AdminChatPanelProps = {
  /** When true, use a fixed viewport-bounded height on /admin (messages scroll inside). */
  fillColumn?: boolean
}

/**
 * Admin-only chat backed by `public.admin_messages`. Render only on /admin (or behind admin gate).
 */
export function AdminChatPanel({ fillColumn = false }: AdminChatPanelProps) {
  const router = useRouter()
  const [messages, setMessages] = useState<AdminMessage[]>([])
  const [content, setContent] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [userInfoMap, setUserInfoMap] = useState<Record<string, ChatUserInfo>>({})
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [mentionCandidates, setMentionCandidates] = useState<
    { userId: string; username: string }[]
  >([])
  const [replyTo, setReplyTo] = useState<AdminMessage | null>(null)

  const scrollContainerRef = useRef<HTMLElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)

  const usernameKeyToUserId = useMemo(
    () => buildUsernameKeyToUserIdMap(mentionCandidates),
    [mentionCandidates]
  )

  const addMessageIfMissing = (prev: AdminMessage[], incoming: AdminMessage) => {
    if (prev.some((m) => m.id === incoming.id)) return prev
    return [...prev, incoming].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
  }

  useEffect(() => {
    if (loadingMessages || sending) return
    if (typeof window === 'undefined') return
    if (!window.matchMedia('(min-width: 768px)').matches) return
    const tid = window.setTimeout(() => {
      chatInputRef.current?.focus({ preventScroll: true })
    }, 50)
    return () => window.clearTimeout(tid)
  }, [loadingMessages, sending])

  useEffect(() => {
    let isMounted = true
    let removeChannel: (() => void) | undefined

    removeAdminChatChannel()

    const load = async () => {
      setError('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.replace('/login')
        return
      }

      if (!isMounted) return

      const profile = await getProfileByUserId(user.id)
      if (!profile) {
        router.replace('/complete-profile')
        return
      }

      if (!profile.is_admin) {
        router.replace('/leagues')
        return
      }

      if (!isMounted) return

      setUserId(user.id)

      const { data: adminProfs, error: adminProfErr } = await supabase
        .from('profiles')
        .select('id, username')
        .eq('is_admin', true)
        .order('username')

      if (isMounted) {
        if (!adminProfErr && adminProfs) {
          const opts = (adminProfs as { id: string; username: string | null }[]).map((r) => ({
            userId: r.id,
            username: (r.username?.trim() ? r.username.trim() : shortenUserId(r.id)) as string,
          }))
          setMentionCandidates(opts)
        } else {
          setMentionCandidates([])
        }
      }

      const { data, error: fetchError } = await supabase
        .from('admin_messages')
        .select('id, user_id, content, created_at, reply_to_admin_message_id')
        .order('created_at', { ascending: true })

      if (fetchError) {
        if (isMounted) setError(fetchError.message)
      } else {
        const rows = (data ?? []) as AdminMessage[]
        if (isMounted) {
          setMessages(rows)
          if (rows.length > 0) {
            const infos = await getUsernameMap(rows.map((r) => r.user_id))
            if (isMounted) setUserInfoMap(infos)
          }
        }
      }

      if (isMounted) setLoadingMessages(false)

      if (!isMounted) return

      removeAdminChatChannel()

      const channel = supabase
        .channel(CHANNEL_NAME)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'admin_messages',
          },
          (payload) => {
            const row = payload.new as AdminMessage
            setMessages((prev) => addMessageIfMissing(prev, row))
            void getUsernameMap([row.user_id]).then((infos) => {
              setUserInfoMap((p) => ({ ...p, ...infos }))
            })
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'admin_messages',
          },
          (payload) => {
            const id = (payload.old as { id?: string } | null)?.id
            if (id) setMessages((prev) => prev.filter((m) => m.id !== id))
          }
        )

      channel.subscribe()

      removeChannel = () => {
        void supabase.removeChannel(channel)
      }
    }

    void load()

    return () => {
      isMounted = false
      removeChannel?.()
      removeAdminChatChannel()
    }
  }, [router])

  const handleSend = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = content.trim()
    if (!trimmed || !userId) return

    setSending(true)
    setError('')

    const { data, error: insertError } = await supabase
      .from('admin_messages')
      .insert({
        user_id: userId,
        content: trimmed,
        reply_to_admin_message_id: replyTo?.id ?? null,
      })
      .select('id, user_id, content, created_at, reply_to_admin_message_id')
      .single()

    setSending(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    const row = data as AdminMessage

    if (trimmed.includes('@')) {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (token) {
        const res = await fetch('/api/chat/apply-mentions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ adminMessageId: row.id }),
        })
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string }
          setError(
            `Meldingen ble sendt, men nevnelser ble ikke lagret: ${payload.error ?? `HTTP ${res.status}`}.`
          )
        }
      }
    }

    setMessages((prev) => addMessageIfMissing(prev, row))
    void getUsernameMap([userId]).then((infos) => {
      setUserInfoMap((p) => ({ ...p, ...infos }))
    })
    setContent('')
    setReplyTo(null)
  }

  const handleDeleteOwnMessage = async (messageId: string) => {
    if (!userId) return
    if (!window.confirm('Slette denne meldingen?')) return

    setDeletingMessageId(messageId)
    try {
      const { error: delError } = await supabase
        .from('admin_messages')
        .delete()
        .eq('id', messageId)
        .eq('user_id', userId)

      if (delError) {
        window.alert(delError.message)
        return
      }
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
    } finally {
      setDeletingMessageId(null)
    }
  }

  useLayoutEffect(() => {
    if (loadingMessages) return
    const el = scrollContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [loadingMessages, messages, userInfoMap])

  /** Fixed outer height so the panel never grows with message count; inner section scrolls. */
  const heightClasses = fillColumn
    ? 'h-[min(24rem,52dvh)] sm:h-[min(26rem,54dvh)] shrink-0'
    : 'h-[min(52dvh,24rem)] min-h-[220px] sm:h-[min(50dvh,26rem)] sm:min-h-[240px]'

  return (
    <div
      className={`flex w-full flex-col overflow-x-hidden overflow-y-visible rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-200/80 ${heightClasses}`}
    >
      <section
        ref={scrollContainerRef}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-slate-50/50 p-3 sm:space-y-3 sm:p-4"
      >
        {loadingMessages ? (
          <p className="text-sm text-slate-500">Laster...</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-slate-500">Ingen meldinger ennå.</p>
        ) : (
          messages.map((message) => {
            const info = userInfoMap[message.user_id]
            const label = info?.username ?? shortenUserId(message.user_id)
            const isOwn = userId !== null && message.user_id === userId
            return (
              <ChatMessageBubble
                key={message.id}
                content={message.content}
                usernameLabel={label}
                isAdmin={info?.isAdmin === true}
                createdAtLabel={new Date(message.created_at).toLocaleString('nb-NO')}
                isOwn={isOwn}
                repliedTo={buildRepliedToPayload(
                  messages,
                  message.reply_to_admin_message_id,
                  userInfoMap,
                  shortenUserId,
                  userId
                )}
                onReply={
                  userId
                    ? () => {
                        setReplyTo(message)
                        requestAnimationFrame(() => chatInputRef.current?.focus())
                      }
                    : undefined
                }
                onDelete={
                  isOwn ? () => void handleDeleteOwnMessage(message.id) : undefined
                }
                deletePending={deletingMessageId === message.id}
              />
            )
          })
        )}
      </section>

      <form
        onSubmit={(e) => void handleSend(e)}
        className="relative z-20 shrink-0 space-y-2 overflow-visible border-t border-slate-200 bg-white p-3 sm:p-4"
      >
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        {replyTo ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-100/90 px-3 py-2 text-xs text-slate-700">
            <span className="min-w-0 truncate">
              <span className="font-medium">Svar til </span>
              {userInfoMap[replyTo.user_id]?.username ?? shortenUserId(replyTo.user_id)}:{' '}
              {replyTo.content.length > 80 ? `${replyTo.content.slice(0, 80)}…` : replyTo.content}
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="shrink-0 font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900"
            >
              Avbryt
            </button>
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <ChatMentionTextField
            id="admin-chat-input"
            label="Admin-melding (bruk @ for å nevne)"
            value={content}
            onChange={setContent}
            disabled={sending || loadingMessages}
            placeholder="Melding til adminer… (@ for å nevne)"
            candidates={mentionCandidates}
            emptyCandidatesHint="Fant ingen admin-brukere å foreslå."
            listAriaLabel="Nevn admin"
            inputRef={chatInputRef}
          />
          <button
            type="submit"
            disabled={sending || loadingMessages || !content.trim()}
            className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? 'Sender...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
}
