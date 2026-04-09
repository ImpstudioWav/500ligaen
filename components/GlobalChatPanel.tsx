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
  profileHasUsername,
  shortenUserId,
} from '@/lib/profiles'
import { buildRepliedToPayload } from '@/lib/chatReplyPreview'

type Message = {
  id: string
  user_id: string
  content: string
  created_at: string
  league_id?: string | null
  reply_to_message_id?: string | null
}

type GlobalChatPanelProps = {
  /** When true, grow to fill a parent flex column (full-page / wide embed only) */
  fillColumn?: boolean
  /** If set (e.g. 50 on /leagues), fetch and show at most this many latest messages; send + realtime stay trimmed */
  previewMessageLimit?: number
  /** Tighter layout for the floating desktop widget (use with previewMessageLimit) */
  compactLayout?: boolean
  /** `id` of the message `<input>` (required if multiple panels can mount) */
  inputId?: string
  /** `id` for the admin clear-confirm field when inputId is customized */
  clearConfirmFieldId?: string
}

/**
 * Global messages (league_id IS NULL): load history, realtime inserts, send form.
 */
export function GlobalChatPanel({
  fillColumn = false,
  previewMessageLimit,
  compactLayout = false,
  inputId = 'global-chat-input',
  clearConfirmFieldId = 'global-chat-clear-confirm',
}: GlobalChatPanelProps) {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [content, setContent] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [userInfoMap, setUserInfoMap] = useState<Record<string, ChatUserInfo>>({})
  const [isAdmin, setIsAdmin] = useState(false)
  const [clearPanelOpen, setClearPanelOpen] = useState(false)
  const [clearTypeConfirm, setClearTypeConfirm] = useState('')
  const [clearError, setClearError] = useState('')
  const [clearSuccess, setClearSuccess] = useState('')
  const [clearingGlobal, setClearingGlobal] = useState(false)
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [mentionCandidates, setMentionCandidates] = useState<
    { userId: string; username: string }[]
  >([])
  const [replyTo, setReplyTo] = useState<Message | null>(null)

  const scrollContainerRef = useRef<HTMLElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)
  /** Bumps when the load effect cleans up so in-flight fetches cannot subscribe or mutate state. */
  const globalChatLoadGenerationRef = useRef(0)

  const usernameKeyToUserId = useMemo(
    () => buildUsernameKeyToUserIdMap(mentionCandidates),
    [mentionCandidates]
  )

  const isPreview = previewMessageLimit != null && previewMessageLimit > 0
  const previewCap = previewMessageLimit ?? 0

  const addMessageIfMissing = (prev: Message[], incoming: Message) => {
    if (prev.some((message) => message.id === incoming.id)) {
      return prev
    }

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
    const gen = ++globalChatLoadGenerationRef.current
    let isMounted = true

    setLoadingMessages(true)

    const loadChat = async () => {
      setError('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.replace('/login')
        return
      }

      if (!isMounted || gen !== globalChatLoadGenerationRef.current) return

      const profile = await getProfileByUserId(user.id)
      if (!profileHasUsername(profile)) {
        router.replace('/complete-profile')
        return
      }

      if (!isMounted || gen !== globalChatLoadGenerationRef.current) return

      setUserId(user.id)
      setIsAdmin(profile.is_admin === true)

      const { data: profRows, error: profErr } = await supabase
        .from('profiles')
        .select('id, username')
        .order('username')
        .limit(500)

      if (!isMounted || gen !== globalChatLoadGenerationRef.current) return

      if (!profErr && profRows) {
        const opts = (profRows as { id: string; username: string | null }[]).map((r) => ({
          userId: r.id,
          username: (r.username?.trim() ? r.username.trim() : shortenUserId(r.id)) as string,
        }))
        setMentionCandidates(opts)
      } else {
        setMentionCandidates([])
      }

      let query = supabase
        .from('messages')
        .select('id, user_id, content, created_at, league_id, reply_to_message_id')
        .is('league_id', null)

      if (isPreview) {
        query = query.order('created_at', { ascending: false }).limit(previewCap)
      } else {
        query = query.order('created_at', { ascending: true })
      }

      const { data, error: messagesError } = await query

      if (!isMounted || gen !== globalChatLoadGenerationRef.current) return

      if (messagesError) {
        setError(messagesError.message)
      } else {
        const fetchedMessages = (
          isPreview ? [...(data ?? [])].reverse() : (data ?? [])
        ) as Message[]
        setMessages(fetchedMessages)
        const userInfos = await getUsernameMap(fetchedMessages.map((message) => message.user_id))
        if (!isMounted || gen !== globalChatLoadGenerationRef.current) return
        setUserInfoMap(userInfos)
      }

      if (!isMounted || gen !== globalChatLoadGenerationRef.current) return
      setLoadingMessages(false)
    }

    void loadChat()

    return () => {
      isMounted = false
      globalChatLoadGenerationRef.current++
    }
  }, [router, isPreview, previewCap])

  useEffect(() => {
    if (!userId || loadingMessages) return

    const channelTopic = `global-messages:${crypto.randomUUID()}`
    let alive = true

    const ch = supabase.channel(channelTopic)

    ch.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        if (!alive) return
        const newMessage = payload.new as Message
        if (newMessage.league_id != null) return
        setMessages((prev) => {
          const next = addMessageIfMissing(prev, newMessage)
          if (isPreview) return next.slice(-previewCap)
          return next
        })
        void getUsernameMap([newMessage.user_id]).then((infos) => {
          if (!alive) return
          setUserInfoMap((p) => ({ ...p, ...infos }))
        })
      }
    ).on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages' },
      (payload) => {
        if (!alive) return
        const deletedId = (payload.old as { id?: string } | undefined)?.id
        if (!deletedId) return
        setMessages((prev) => {
          if (!prev.some((m) => m.id === deletedId)) return prev
          return prev.filter((m) => m.id !== deletedId)
        })
      }
    )

    ch.subscribe()

    return () => {
      alive = false
      void supabase.removeChannel(ch)
    }
  }, [userId, loadingMessages, isPreview, previewCap])

  const handleSend = async (e: FormEvent) => {
    e.preventDefault()

    const trimmed = content.trim()
    if (!trimmed || !userId) return

    setSending(true)
    setError('')

    const {
      data: { session },
    } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) {
      setSending(false)
      setError('Fant ikke innlogging. Prøv å logge inn på nytt.')
      return
    }

    const res = await fetch('/api/chat/send-global', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        content: trimmed,
        replyToMessageId: replyTo?.id ?? undefined,
      }),
    })

    const payload = (await res.json().catch(() => ({}))) as {
      error?: string
      message?: Message
      /** Present when send succeeded but global trim failed; safe to ignore in UI */
      warning?: string
    }

    setSending(false)

    if (!res.ok) {
      setError(payload.error || `Kunne ikke sende melding (HTTP ${res.status}).`)
      return
    }

    const data = payload.message
    if (!data) {
      setError('Ugyldig svar fra server.')
      return
    }

    setMessages((prev) => {
      const next = addMessageIfMissing(prev, data)
      if (isPreview) return next.slice(-previewCap)
      return next
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
        .from('messages')
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

  const handleClearGlobalChat = async () => {
    if (clearTypeConfirm !== 'DELETE') return

    const ok = window.confirm(
      'Slette alle globale chatmeldinger?\n\nDette fjerner alle meldinger i den globale chatten for alle brukere. Liga-chatter berøres ikke. Kan ikke angres.'
    )
    if (!ok) return

    setClearError('')
    setClearingGlobal(true)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        setClearError('Fant ikke innlogging. Prøv å logge inn på nytt.')
        setClearingGlobal(false)
        return
      }

      const res = await fetch('/api/admin/clear-global-chat', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const payload = (await res.json().catch(() => ({}))) as { error?: string }

      if (!res.ok) {
        setClearError(payload.error || `Kunne ikke slette (HTTP ${res.status}).`)
        setClearingGlobal(false)
        return
      }

      setMessages([])
      setUserInfoMap({})
      setClearPanelOpen(false)
      setClearTypeConfirm('')
      setClearSuccess('All global chat er tømt.')
      window.setTimeout(() => setClearSuccess(''), 5000)
    } catch {
      setClearError('Nettverksfeil. Prøv igjen.')
    } finally {
      setClearingGlobal(false)
    }
  }

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        router.replace('/login')
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  useLayoutEffect(() => {
    if (loadingMessages) return

    const el = scrollContainerRef.current
    if (!el) return

    el.scrollTop = el.scrollHeight
  }, [loadingMessages, messages, userInfoMap])

  let heightClasses: string
  if (compactLayout && isPreview) {
    heightClasses = 'flex min-h-0 w-full max-h-full flex-1 flex-col overflow-hidden'
  } else if (isPreview) {
    heightClasses = 'w-full'
  } else if (fillColumn) {
    heightClasses =
      'h-[min(52dvh,22rem)] min-h-[14rem] sm:h-[min(50dvh,26rem)] sm:min-h-[16rem] lg:h-full lg:min-h-0 lg:max-h-full lg:flex-1'
  } else {
    /** Full /chat page: bounded height, input stays at bottom of panel */
    heightClasses =
      'h-[min(70dvh,calc(100dvh-12rem))] max-h-[min(85dvh,calc(100dvh-8rem))] min-h-[240px]'
  }

  const messagesScrollClass =
    compactLayout && isPreview
      ? 'min-h-0 flex-1 overflow-y-auto bg-slate-50/50 p-2.5 space-y-2'
      : isPreview
        ? 'h-[min(50dvh,26rem)] min-h-[220px] max-h-[min(60dvh,32rem)] shrink-0 sm:min-h-[240px] sm:h-[min(52dvh,28rem)]'
        : fillColumn
          ? 'min-h-0 flex-1'
          : 'max-h-[60vh] min-h-0 flex-1 overflow-y-auto'

  const sectionPad =
    compactLayout && isPreview ? '' : 'space-y-2.5 sm:space-y-3 p-3 sm:p-4'

  const shellClass =
    compactLayout && isPreview
      ? 'flex w-full min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-visible rounded-none border-0 bg-white shadow-none ring-0'
      : 'flex w-full flex-col overflow-x-hidden overflow-y-visible rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-200/80'

  const formPad = compactLayout ? 'p-2.5' : 'p-3 sm:p-4'
  const adminPad = compactLayout ? 'px-2.5 pb-2.5 pt-2' : 'px-3 pb-3 pt-2 sm:px-4'

  return (
    <div className={`${shellClass} ${heightClasses}`}>
      <section
        ref={scrollContainerRef}
        className={`overflow-y-auto bg-slate-50/50 ${sectionPad} ${messagesScrollClass}`}
      >
        {loadingMessages ? (
          <p className="text-sm text-slate-500">Laster meldinger...</p>
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
                  message.reply_to_message_id,
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
        onSubmit={handleSend}
        className={`relative z-20 shrink-0 space-y-2 overflow-visible border-t border-slate-200 bg-white ${formPad}`}
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
            id={inputId}
            label="Global melding (bruk @ for å nevne)"
            value={content}
            onChange={setContent}
            disabled={sending || loadingMessages}
            placeholder="Skriv en global melding… (@ for å nevne)"
            candidates={mentionCandidates}
            emptyCandidatesHint="Fant ingen brukerprofiler (sjekk RLS på profiles)."
            listAriaLabel="Nevn bruker"
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

      {isAdmin && !loadingMessages ? (
        <div className={`shrink-0 border-t border-slate-200 bg-white ${adminPad}`}>
          {clearSuccess ? (
            <p className="mb-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">
              {clearSuccess}
            </p>
          ) : null}

          {!clearPanelOpen ? (
            <button
              type="button"
              onClick={() => {
                setClearPanelOpen(true)
                setClearTypeConfirm('')
                setClearError('')
              }}
              className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 transition hover:border-red-300 hover:bg-red-100 sm:max-w-xs"
            >
              Slett all global chat
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-red-200/90 bg-red-50/50 p-3">
              <p className="text-xs leading-relaxed text-red-950/85">
                Alle globale meldinger slettes permanent fra databasen. Liga-chatter med{' '}
                <span className="font-mono">league_id</span> slettes ikke.
              </p>
              <div>
                <label
                  htmlFor={clearConfirmFieldId}
                  className="mb-1 block text-[11px] font-medium text-red-950/90"
                >
                  Skriv <span className="font-mono font-semibold">DELETE</span> for å bekrefte
                </label>
                <input
                  id={clearConfirmFieldId}
                  type="text"
                  autoComplete="off"
                  value={clearTypeConfirm}
                  onChange={(e) => {
                    setClearTypeConfirm(e.target.value)
                    if (clearError) setClearError('')
                  }}
                  disabled={clearingGlobal}
                  placeholder="DELETE"
                  className="w-full rounded-lg border border-red-200 bg-white px-2.5 py-2 font-mono text-sm text-slate-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:opacity-60"
                />
              </div>
              {clearError ? (
                <p className="rounded-md bg-red-100 px-2 py-1.5 text-xs text-red-800">{clearError}</p>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  disabled={clearingGlobal || clearTypeConfirm !== 'DELETE'}
                  onClick={() => void handleClearGlobalChat()}
                  className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-800 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {clearingGlobal ? 'Sletter...' : 'Tøm global chat'}
                </button>
                <button
                  type="button"
                  disabled={clearingGlobal}
                  onClick={() => {
                    setClearPanelOpen(false)
                    setClearTypeConfirm('')
                    setClearError('')
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Avbryt
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
