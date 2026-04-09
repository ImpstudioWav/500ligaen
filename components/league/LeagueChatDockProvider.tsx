'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LeagueChatPanel } from '@/components/league/LeagueChatPanel'
import {
  countUnreadMessagesFromOthers,
  LEAGUE_CHAT_READ_EVENT,
  setLastReadMessageId,
} from '@/lib/leagueChatReadState'
import { supabase } from '@/lib/supabase'

/** First path segment after `/league/` (league id), if URL is under a league. */
export function parseRouteLeagueId(pathname: string | null): string | null {
  if (!pathname) return null
  const m = pathname.match(/^\/league\/([^/]+)/)
  return m?.[1] ?? null
}

function isFullLeagueChatPath(pathname: string | null, leagueId: string | null): boolean {
  if (!pathname || !leagueId) return false
  return (
    pathname === `/league/${leagueId}/chat` || pathname === `/league/${leagueId}/chat/`
  )
}

/**
 * Paths stored for league chat @mention notifications: `/league/{id}` (hub) or legacy `/league/{id}/chat`.
 * Returns the league id when the path is a league mention destination (not sub-routes like `/predictions`).
 */
export function parseLeagueChatNotificationPath(path: string): string | null {
  const trimmed = path.trim()
  const noTrail = trimmed.replace(/\/+$/, '') || trimmed
  const m = noTrail.match(/^\/league\/([^/]+)(?:\/chat)?$/)
  return m?.[1] ?? null
}

type LeagueChatDockContextValue = {
  launcherOpen: boolean
  setLauncherOpen: (open: boolean) => void
  toggleLauncher: () => void
  selectLeagueFromLauncher: (leagueId: string, leagueName: string) => void
  /**
   * From league-chat mention notifications: go to `/league/{id}` (if needed) and expand the floating bubble.
   * When already under that league (any sub-route except full chat page), expands only. From full chat page,
   * navigates to the league hub so the dock can show the float.
   */
  openFloatingLeagueChat: (leagueId: string) => void
  /** Bump to refetch launcher previews (e.g. after marking read elsewhere) */
  bumpListVersion: () => void
  listVersion: number
  /**
   * Floating league panel is expanded (not minimized to the pill). League hub can hide the
   * embedded chat while this is true to avoid duplicate UIs. False when the float is hidden or minimized.
   */
  isChatBubbleOpen: boolean
  /** League id from the current route (`/league/[id]/…`), or null. Used to dedupe launcher unread vs bubble. */
  routeLeagueId: string | null
}

const LeagueChatDockContext = createContext<LeagueChatDockContextValue | null>(null)

export function useLeagueChatDock() {
  const ctx = useContext(LeagueChatDockContext)
  if (!ctx) {
    throw new Error('useLeagueChatDock must be used within LeagueChatDockProvider')
  }
  return ctx
}

export function useLeagueChatDockOptional() {
  return useContext(LeagueChatDockContext)
}

export function LeagueChatDockProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [listVersion, setListVersion] = useState(0)

  /** Default minimized so league routes show a bubble first; launcher opens expanded */
  const [floatMinimized, setFloatMinimized] = useState(true)
  const [floatUnreadCount, setFloatUnreadCount] = useState(0)

  /** After launcher picks a league off `/league/[id]`, navigate first; expand float when this matches `routeLeagueId`. */
  const pendingOpenFloatLeagueRef = useRef<string | null>(null)

  const routeLeagueId = useMemo(() => parseRouteLeagueId(pathname), [pathname])
  const fullLeagueChatOpen = useMemo(
    () => isFullLeagueChatPath(pathname, routeLeagueId),
    [pathname, routeLeagueId]
  )

  const prevRouteLeagueRef = useRef<string | null | undefined>(undefined)

  /**
   * - Launcher navigation: when `routeLeagueId` matches pending, expand float (do not collapse in same tick).
   * - Any other league id change in the URL: minimize so the bubble stays a pill on the new league page.
   */
  useEffect(() => {
    const pending = pendingOpenFloatLeagueRef.current
    let openedFromPending = false
    if (pending !== null && routeLeagueId === pending) {
      pendingOpenFloatLeagueRef.current = null
      setFloatMinimized(false)
      openedFromPending = true
    }

    if (prevRouteLeagueRef.current === undefined) {
      prevRouteLeagueRef.current = routeLeagueId
      return
    }

    if (routeLeagueId !== prevRouteLeagueRef.current) {
      if (routeLeagueId && !openedFromPending) {
        setFloatMinimized(true)
      }
      prevRouteLeagueRef.current = routeLeagueId
    }
  }, [routeLeagueId])

  const bumpListVersion = useCallback(() => {
    setListVersion((v) => v + 1)
  }, [])

  const openFloatingLeagueChat = useCallback(
    (leagueId: string) => {
      setLauncherOpen(false)
      const onThisLeague = routeLeagueId === leagueId
      if (onThisLeague && !fullLeagueChatOpen) {
        setFloatMinimized(false)
        return
      }
      pendingOpenFloatLeagueRef.current = leagueId
      router.push(`/league/${leagueId}`)
    },
    [routeLeagueId, fullLeagueChatOpen, router]
  )

  const selectLeagueFromLauncher = useCallback(
    (leagueId: string, _leagueName: string) => {
      openFloatingLeagueChat(leagueId)
    },
    [openFloatingLeagueChat]
  )

  const handleThreadActivity = useCallback(
    (info: { leagueId: string; latestMessageId: string | null }) => {
      if (!routeLeagueId || info.leagueId !== routeLeagueId) return
      if (floatMinimized) return
      if (info.latestMessageId) {
        setLastReadMessageId(info.leagueId, info.latestMessageId)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(LEAGUE_CHAT_READ_EVENT))
        }
        bumpListVersion()
      }
    },
    [routeLeagueId, floatMinimized, bumpListVersion]
  )

  const showLeagueFloat = !!routeLeagueId && !fullLeagueChatOpen

  const isChatBubbleOpen = showLeagueFloat && !floatMinimized

  /** Unread count on the minimized pill only; uses session read cursor + full thread (same as chat panel query). */
  useEffect(() => {
    if (!routeLeagueId || !showLeagueFloat || !floatMinimized) {
      setFloatUnreadCount(0)
      return
    }

    let cancelled = false
    const leagueId = routeLeagueId

    const recalc = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) return

      const { data, error } = await supabase
        .from('messages')
        .select('id, user_id')
        .eq('league_id', leagueId)
        .order('created_at', { ascending: true })

      if (cancelled || error) return
      setFloatUnreadCount(
        countUnreadMessagesFromOthers(leagueId, data ?? [], user.id)
      )
    }

    void recalc()

    const channelName = `league-float-unread:${leagueId}:${Math.random().toString(36).slice(2)}`
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          void recalc()
        }
      )
      .subscribe()

    const onRead = () => void recalc()
    window.addEventListener(LEAGUE_CHAT_READ_EVENT, onRead)

    return () => {
      cancelled = true
      window.removeEventListener(LEAGUE_CHAT_READ_EVENT, onRead)
      void supabase.removeChannel(channel)
    }
  }, [routeLeagueId, showLeagueFloat, floatMinimized, listVersion])

  const ctxValue = useMemo(
    () => ({
      launcherOpen,
      setLauncherOpen,
      toggleLauncher: () => setLauncherOpen((o) => !o),
      selectLeagueFromLauncher,
      openFloatingLeagueChat,
      bumpListVersion,
      listVersion,
      isChatBubbleOpen,
      routeLeagueId,
    }),
    [
      launcherOpen,
      selectLeagueFromLauncher,
      openFloatingLeagueChat,
      bumpListVersion,
      listVersion,
      isChatBubbleOpen,
      routeLeagueId,
    ]
  )

  /** Mobile: larger `bottom-*` lifts float away from screen edge; `sm:` restores desktop offsets. */
  const floatPositionClass =
    routeLeagueId && !fullLeagueChatOpen
      ? 'bottom-14 right-4 sm:bottom-5 sm:right-5'
      : 'bottom-32 right-4 sm:bottom-24 sm:right-5'

  const dismissFloat = useCallback(() => {
    if (routeLeagueId) {
      setFloatMinimized(true)
    }
  }, [routeLeagueId])

  return (
    <LeagueChatDockContext.Provider value={ctxValue}>
      {children}
      {showLeagueFloat && floatMinimized ? (
        <button
          type="button"
          onClick={() => setFloatMinimized(false)}
          className={`fixed z-[85] inline-flex shrink-0 items-center gap-2 overflow-visible rounded-full border border-slate-200 bg-slate-900 py-2 pl-3 pr-2 text-sm font-medium text-white shadow-lg ring-1 ring-slate-900/10 transition hover:bg-slate-800 ${floatPositionClass}`}
          aria-label={
            floatUnreadCount > 0
              ? `Utvid Liga Chat, ${floatUnreadCount} uleste meldinger`
              : 'Utvid Liga Chat'
          }
        >
          {floatUnreadCount > 0 ? (
            <span
              className="pointer-events-none absolute -right-1 -top-1 z-[1] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-slate-900"
              aria-hidden
            >
              {floatUnreadCount > 99 ? '99+' : floatUnreadCount}
            </span>
          ) : null}
          <span className="shrink-0">Liga Chat</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-4 w-4 shrink-0 opacity-80"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      ) : null}
      {showLeagueFloat && !floatMinimized ? (
        <div
          className={`fixed z-[85] flex h-[min(72vh,28rem)] w-[min(22rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-slate-900/10 ${floatPositionClass}`}
          role="dialog"
          aria-label="Liga Chat"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2.5 text-white">
            <span className="min-w-0 truncate text-sm font-semibold tracking-tight">Liga Chat</span>
            <div className="flex shrink-0 items-center gap-1">
              <Link
                href={`/league/${routeLeagueId}/chat`}
                className="rounded-md px-2 py-1 text-xs font-medium text-white/90 underline-offset-2 hover:bg-white/10 hover:text-white"
              >
                Åpne full
              </Link>
              <button
                type="button"
                onClick={() => setFloatMinimized(true)}
                className="rounded-md p-1.5 text-white/90 hover:bg-white/10 hover:text-white"
                aria-label="Minimer ligachat"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="h-5 w-5"
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={dismissFloat}
                className="rounded-md p-1.5 text-sm font-medium text-white/90 hover:bg-white/10 hover:text-white"
                aria-label={routeLeagueId ? 'Minimer ligachat' : 'Lukk ligachat'}
              >
                ×
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <LeagueChatPanel
              key={routeLeagueId}
              leagueId={routeLeagueId as string}
              variant="float"
              onThreadActivity={handleThreadActivity}
            />
          </div>
        </div>
      ) : null}
    </LeagueChatDockContext.Provider>
  )
}
