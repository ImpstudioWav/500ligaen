'use client'

import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  type ChatUserInfo,
  getProfileByUserId,
  getUsernameMap,
  shortenUserId,
} from '@/lib/profiles'

type AdminMessage = {
  id: string
  user_id: string
  content: string
  created_at: string
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

  const scrollContainerRef = useRef<HTMLElement>(null)

  const addMessageIfMissing = (prev: AdminMessage[], incoming: AdminMessage) => {
    if (prev.some((m) => m.id === incoming.id)) return prev
    return [...prev, incoming].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
  }

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

      const { data, error: fetchError } = await supabase
        .from('admin_messages')
        .select('id, user_id, content, created_at')
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
      .insert({ user_id: userId, content: trimmed })
      .select('id, user_id, content, created_at')
      .single()

    setSending(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setMessages((prev) => addMessageIfMissing(prev, data as AdminMessage))
    void getUsernameMap([userId]).then((infos) => {
      setUserInfoMap((p) => ({ ...p, ...infos }))
    })
    setContent('')
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
      className={`flex w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-200/80 ${heightClasses}`}
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
              <article key={message.id} className="rounded-xl bg-slate-100 px-3 py-2">
                <p className="text-sm text-slate-900">{message.content}</p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                  <p className="min-w-0 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500">
                    <span className="inline-flex flex-wrap items-center gap-x-1.5">
                      <span>{label}</span>
                      {info?.isAdmin ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-amber-900">
                          ADMIN
                        </span>
                      ) : null}
                    </span>
                    <span aria-hidden>•</span>
                    <span>{new Date(message.created_at).toLocaleString('nb-NO')}</span>
                  </p>
                  {isOwn ? (
                    <button
                      type="button"
                      onClick={() => void handleDeleteOwnMessage(message.id)}
                      disabled={deletingMessageId === message.id}
                      className="shrink-0 text-[10px] font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 transition hover:text-red-700 disabled:opacity-50"
                    >
                      {deletingMessageId === message.id ? '…' : 'Slett'}
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })
        )}
      </section>

      <form
        onSubmit={(e) => void handleSend(e)}
        className="shrink-0 space-y-2 border-t border-slate-200 bg-white p-3 sm:p-4"
      >
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Melding til adminer..."
            className="w-full min-w-0 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            disabled={sending || loadingMessages}
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
