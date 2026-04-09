'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import {
  parseLeagueChatNotificationPath,
  useLeagueChatDockOptional,
} from '@/components/league/LeagueChatDockProvider'

type NotificationRow = {
  id: string
  title: string
  body: string
  link: string
  is_read: boolean
  created_at: string
}

const FETCH_LIMIT = 40

const MS_MIN = 60_000
const MS_HOUR = 3_600_000
const MS_DAY = 86_400_000
/** Relative phrases until this many days; older → calendar date */
const RELATIVE_MAX_DAYS = 7

function formatNotifTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''

  const now = Date.now()
  const diff = now - d.getTime()
  const thisYear = new Date().getFullYear()

  if (diff < 0) {
    return d.toLocaleDateString('nb-NO', {
      day: 'numeric',
      month: 'short',
      ...(d.getFullYear() !== thisYear ? { year: 'numeric' as const } : {}),
    })
  }

  if (diff < MS_MIN) return 'nå'

  if (diff < MS_HOUR) {
    const mins = Math.floor(diff / MS_MIN)
    return `${mins} min siden`
  }

  if (diff < MS_DAY) {
    const hours = Math.floor(diff / MS_HOUR)
    return hours === 1 ? '1 time siden' : `${hours} timer siden`
  }

  if (diff < MS_DAY * RELATIVE_MAX_DAYS) {
    const days = Math.floor(diff / MS_DAY)
    return days === 1 ? '1 dag siden' : `${days} dager siden`
  }

  return d.toLocaleDateString('nb-NO', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== thisYear ? { year: 'numeric' as const } : {}),
  })
}

function notificationFromRealtimeRecord(
  record: Record<string, unknown> | null | undefined,
  expectedUserId: string
): NotificationRow | null {
  if (!record || typeof record !== 'object') return null
  if (record.user_id !== expectedUserId) return null
  const id = record.id
  const title = record.title
  const body = record.body
  const link = record.link
  const created_at = record.created_at
  if (
    typeof id !== 'string' ||
    typeof title !== 'string' ||
    typeof body !== 'string' ||
    typeof link !== 'string' ||
    typeof created_at !== 'string'
  ) {
    return null
  }
  const rawRead = record.is_read
  const is_read = rawRead === true || rawRead === 't' || rawRead === 'true'
  return { id, title, body, link, is_read, created_at }
}

function mergeNotificationList(prev: NotificationRow[], row: NotificationRow): NotificationRow[] {
  const without = prev.filter((n) => n.id !== row.id)
  const next = [row, ...without].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
  return next.slice(0, FETCH_LIMIT)
}

export function NavNotifications() {
  const router = useRouter()
  const leagueChatDock = useLeagueChatDockOptional()
  const [userId, setUserId] = useState<string | null>(null)
  const [items, setItems] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  /** Ignore late DB responses after logout / user switch */
  const fetchUserIdRef = useRef<string | null>(null)

  const fetchRowsForUser = useCallback(async (forUserId: string) => {
    fetchUserIdRef.current = forUserId
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, title, body, link, is_read, created_at')
        .order('created_at', { ascending: false })
        .limit(FETCH_LIMIT)

      if (fetchUserIdRef.current !== forUserId) return

      if (error || !data) {
        setItems([])
        return
      }
      setItems(data as NotificationRow[])
    } catch {
      if (fetchUserIdRef.current === forUserId) setItems([])
    } finally {
      if (fetchUserIdRef.current === forUserId) setLoading(false)
    }
  }, [])

  const clearSessionState = useCallback(() => {
    fetchUserIdRef.current = null
    setUserId(null)
    setItems([])
  }, [])

  const applyAuthSession = useCallback(
    (session: Session | null, event: AuthChangeEvent) => {
      try {
        if (event === 'TOKEN_REFRESHED') {
          if (session?.user?.id) setUserId(session.user.id)
          else clearSessionState()
          return
        }

        if (!session?.user?.id) {
          clearSessionState()
          return
        }

        const id = session.user.id
        setUserId(id)
        void fetchRowsForUser(id)
      } catch {
        clearSessionState()
      }
    },
    [clearSessionState, fetchRowsForUser]
  )

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      applyAuthSession(session, event)
    })

    return () => subscription.unsubscribe()
  }, [applyAuthSession])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      void supabase.auth
        .getSession()
        .then(({ data: { session }, error }) => {
          if (error || !session?.user?.id) return
          void fetchRowsForUser(session.user.id)
        })
        .catch(() => {})
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [fetchRowsForUser])

  useEffect(() => {
    if (!open || !userId) return
    void fetchRowsForUser(userId)
  }, [open, userId, fetchRowsForUser])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const el = rootRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!userId) return

    let active = true
    const channelRef: { current: ReturnType<typeof supabase.channel> | null } = { current: null }

    void (async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (!active || error || !session?.user?.id || session.user.id !== userId) return

        const channel = supabase
          .channel(`notifications:${userId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'notifications',
              filter: `user_id=eq.${userId}`,
            },
            (payload) => {
              try {
                if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                  const row = notificationFromRealtimeRecord(
                    payload.new as Record<string, unknown>,
                    userId
                  )
                  if (row) {
                    setItems((prev) => mergeNotificationList(prev, row))
                  }
                  return
                }
                if (payload.eventType === 'DELETE') {
                  const oldId = (payload.old as { id?: string } | null)?.id
                  if (typeof oldId === 'string') {
                    setItems((prev) => prev.filter((n) => n.id !== oldId))
                  }
                }
              } catch {
                /* ignore malformed payloads */
              }
            }
          )
          .subscribe()

        if (!active) {
          void supabase.removeChannel(channel)
          return
        }
        channelRef.current = channel
      } catch {
        /* session / realtime unavailable */
      }
    })()

    return () => {
      active = false
      const c = channelRef.current
      channelRef.current = null
      if (c) void supabase.removeChannel(c)
    }
  }, [userId])

  const unreadCount = items.filter((n) => !n.is_read).length

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    )
  }

  const markAllRead = async () => {
    if (unreadCount === 0 || !userId) return
    await supabase.from('notifications').update({ is_read: true }).eq('is_read', false)
    void fetchRowsForUser(userId)
  }

  const onItemClick = async (n: NotificationRow) => {
    await markRead(n.id)
    setOpen(false)
    const href = n.link.trim()
    if (href.startsWith('http://') || href.startsWith('https://')) {
      window.location.href = href
      return
    }
    const path = href.startsWith('/') ? href : `/${href}`

    const leagueIdFromNotif = parseLeagueChatNotificationPath(path)
    if (leagueIdFromNotif) {
      if (leagueChatDock) {
        leagueChatDock.openFloatingLeagueChat(leagueIdFromNotif)
      } else {
        router.push(`/league/${leagueIdFromNotif}`)
      }
      return
    }

    router.push(path)
  }

  if (!userId) return null

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg p-0 text-slate-700 transition hover:bg-slate-100"
        aria-label="Varsler"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-[min(100vw-1rem,22rem)] max-h-[min(70vh,24rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
          role="dialog"
          aria-label="Varsler"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold text-slate-900">Varsler</span>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-xs font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
              >
                Marker alle som lest
              </button>
            ) : null}
          </div>
          <ul className="max-h-[min(65vh,20rem)] overflow-y-auto p-1">
            {loading && items.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-slate-500">Laster…</li>
            ) : items.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-slate-500">Ingen varsler</li>
            ) : (
              items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void onItemClick(n)}
                    className={`w-full rounded-lg px-3 py-2.5 text-left transition ${
                      n.is_read
                        ? 'bg-transparent hover:bg-slate-50/90'
                        : 'bg-blue-50/90 ring-1 ring-inset ring-blue-100/80 hover:bg-blue-100/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={`text-sm ${
                          n.is_read
                            ? 'font-normal text-slate-600'
                            : 'font-semibold text-slate-900'
                        }`}
                      >
                        {n.title}
                      </span>
                      {!n.is_read ? (
                        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" title="Ulest" />
                      ) : null}
                    </div>
                    <p
                      className={`mt-0.5 line-clamp-2 text-xs ${
                        n.is_read ? 'text-slate-500' : 'text-slate-600'
                      }`}
                    >
                      {n.body}
                    </p>
                    <p
                      className={`mt-1 text-[11px] ${
                        n.is_read ? 'text-slate-400' : 'text-slate-500'
                      }`}
                    >
                      {formatNotifTime(n.created_at)}
                    </p>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
