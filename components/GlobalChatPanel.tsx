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

type Message = {
  id: string
  user_id: string
  content: string
  created_at: string
  league_id?: string | null
}

type GlobalChatPanelProps = {
  /** When true, grow to fill a parent flex column (full-page / wide embed only) */
  fillColumn?: boolean
  /** If set (e.g. 50 on /leagues), fetch and show at most this many latest messages; send + realtime stay trimmed */
  previewMessageLimit?: number
}

/**
 * Global messages (league_id IS NULL): load history, realtime inserts, send form.
 */
export function GlobalChatPanel({
  fillColumn = false,
  previewMessageLimit,
}: GlobalChatPanelProps) {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [content, setContent] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [userInfoMap, setUserInfoMap] = useState<Record<string, ChatUserInfo>>({})

  const scrollContainerRef = useRef<HTMLElement>(null)

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
    let isMounted = true
    let removeChannel: (() => void) | undefined

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

      if (!isMounted) return

      const profile = await getProfileByUserId(user.id)
      if (!profile) {
        router.replace('/complete-profile')
        return
      }

      if (!isMounted) return

      setUserId(user.id)

      let query = supabase
        .from('messages')
        .select('id, user_id, content, created_at, league_id')
        .is('league_id', null)

      if (isPreview) {
        query = query.order('created_at', { ascending: false }).limit(previewCap)
      } else {
        query = query.order('created_at', { ascending: true })
      }

      const { data, error: messagesError } = await query

      if (messagesError) {
        if (isMounted) setError(messagesError.message)
      } else {
        const fetchedMessages = (
          isPreview ? [...(data ?? [])].reverse() : (data ?? [])
        ) as Message[]
        if (isMounted) {
          setMessages(fetchedMessages)
          const userInfos = await getUsernameMap(fetchedMessages.map((message) => message.user_id))
          if (isMounted) setUserInfoMap(userInfos)
        }
      }

      if (isMounted) setLoadingMessages(false)

      const channel = supabase
        .channel('public:messages:global')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: 'league_id=is.null',
          },
          (payload) => {
            const newMessage = payload.new as Message
            if (newMessage.league_id != null) return
            setMessages((prev) => {
              const next = addMessageIfMissing(prev, newMessage)
              if (isPreview) return next.slice(-previewCap)
              return next
            })
            void getUsernameMap([newMessage.user_id]).then((infos) => {
              setUserInfoMap((p) => ({ ...p, ...infos }))
            })
          }
        )
        .subscribe()

      removeChannel = () => {
        void supabase.removeChannel(channel)
      }
    }

    void loadChat()

    return () => {
      isMounted = false
      removeChannel?.()
    }
  }, [router, isPreview, previewCap])

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
      body: JSON.stringify({ content: trimmed }),
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
  if (isPreview) {
    heightClasses = 'w-full'
  } else if (fillColumn) {
    heightClasses =
      'h-[min(52dvh,22rem)] min-h-[14rem] sm:h-[min(50dvh,26rem)] sm:min-h-[16rem] lg:h-full lg:min-h-0 lg:max-h-full lg:flex-1'
  } else {
    /** Full /chat page: bounded height, input stays at bottom of panel */
    heightClasses =
      'h-[min(70dvh,calc(100dvh-12rem))] max-h-[min(85dvh,calc(100dvh-8rem))] min-h-[240px]'
  }

  const messagesScrollClass = isPreview
    ? 'h-[min(50dvh,26rem)] min-h-[220px] max-h-[min(60dvh,32rem)] shrink-0 sm:min-h-[240px] sm:h-[min(52dvh,28rem)]'
    : fillColumn
      ? 'min-h-0 flex-1'
      : 'max-h-[60vh] min-h-0 flex-1 overflow-y-auto'

  return (
    <div
      className={`flex w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-200/80 ${heightClasses}`}
    >
      <section
        ref={scrollContainerRef}
        className={`space-y-2.5 overflow-y-auto bg-slate-50/50 p-3 sm:space-y-3 sm:p-4 ${messagesScrollClass}`}
      >
        {loadingMessages ? (
          <p className="text-sm text-slate-500">Laster meldinger...</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-slate-500">Ingen meldinger ennå.</p>
        ) : (
          messages.map((message) => {
            const info = userInfoMap[message.user_id]
            const label = info?.username ?? shortenUserId(message.user_id)
            return (
              <article key={message.id} className="rounded-xl bg-slate-100 px-3 py-2">
                <p className="text-sm text-slate-900">{message.content}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500">
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
              </article>
            )
          })
        )}
      </section>

      <form onSubmit={handleSend} className="shrink-0 space-y-2 border-t border-slate-200 bg-white p-3 sm:p-4">
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Skriv en global melding..."
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
