'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { computeLeagueUnread, LEAGUE_CHAT_READ_EVENT } from '@/lib/leagueChatReadState'
import { useLeagueChatDockOptional } from '@/components/league/LeagueChatDockProvider'

type PreviewRow = {
  leagueId: string
  name: string
  latest: {
    id: string
    content: string
    created_at: string
    user_id: string
  } | null
}

function previewSnippet(content: string, max = 56) {
  const t = content.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

async function loadLeaguePreviewsForUser(): Promise<{
  rows: PreviewRow[]
  userId: string | null
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { rows: [], userId: null }

  const { data: members, error: memErr } = await supabase
    .from('league_members')
    .select('league_id')
    .eq('user_id', user.id)

  if (memErr || !members?.length) {
    return { rows: [], userId: user.id }
  }

  const leagueIds = Array.from(new Set(members.map((m) => m.league_id as string)))

  const { data: leagues, error: leagueErr } = await supabase
    .from('leagues')
    .select('id, name')
    .in('id', leagueIds)

  if (leagueErr) {
    return { rows: [], userId: user.id }
  }

  const nameById = new Map((leagues ?? []).map((l) => [l.id as string, (l.name as string) || 'Liga']))

  const previews = await Promise.all(
    leagueIds.map(async (leagueId) => {
      const { data: msg } = await supabase
        .from('messages')
        .select('id, content, created_at, user_id')
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      return {
        leagueId,
        name: nameById.get(leagueId) ?? 'Liga',
        latest: msg
          ? {
              id: msg.id as string,
              content: (msg.content as string) ?? '',
              created_at: msg.created_at as string,
              user_id: msg.user_id as string,
            }
          : null,
      } as PreviewRow
    })
  )

  previews.sort((a, b) => {
    const ta = a.latest ? new Date(a.latest.created_at).getTime() : 0
    const tb = b.latest ? new Date(b.latest.created_at).getTime() : 0
    return tb - ta
  })

  return { rows: previews, userId: user.id }
}

export function LeagueChatLauncherButton() {
  const dock = useLeagueChatDockOptional()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const [signedIn, setSignedIn] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [unreadTotal, setUnreadTotal] = useState(0)

  const refreshPreviews = useCallback(async () => {
    setLoading(true)
    try {
      const { rows: next, userId } = await loadLeaguePreviewsForUser()
      setRows(next)
      setCurrentUserId(userId)
      const routeCtx = dock?.routeLeagueId ?? null
      let n = 0
      for (const r of next) {
        if (routeCtx !== null && r.leagueId === routeCtx) continue
        if (computeLeagueUnread(r.leagueId, r.latest, userId)) n += 1
      }
      setUnreadTotal(n)
    } finally {
      setLoading(false)
    }
  }, [dock?.routeLeagueId])

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!cancelled) setSignedIn(!!user)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session?.user)
    })
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!signedIn || !dock) return
    void refreshPreviews()
  }, [signedIn, dock?.listVersion, dock?.launcherOpen, dock?.routeLeagueId, refreshPreviews])

  useEffect(() => {
    const onRead = () => void refreshPreviews()
    window.addEventListener(LEAGUE_CHAT_READ_EVENT, onRead)
    return () => window.removeEventListener(LEAGUE_CHAT_READ_EVENT, onRead)
  }, [refreshPreviews])

  useEffect(() => {
    if (!dock?.launcherOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (popoverRef.current?.contains(t)) return
      if (buttonRef.current?.contains(t)) return
      dock.setLauncherOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [dock])

  if (!dock || !signedIn) {
    return null
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => dock.toggleLauncher()}
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-0 text-slate-800 shadow-sm transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        aria-expanded={dock.launcherOpen}
        aria-haspopup="dialog"
        aria-label="Ligachatter"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.75}
          stroke="currentColor"
          className="h-5 w-5"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        {unreadTotal > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {unreadTotal > 9 ? '9+' : unreadTotal}
          </span>
        ) : null}
      </button>

      {dock.launcherOpen ? (
        <div
          ref={popoverRef}
          className="fixed left-3 right-3 top-16 z-[90] max-h-[min(70dvh,24rem)] rounded-xl border border-slate-200 bg-white py-2 shadow-xl ring-1 ring-slate-900/5 md:absolute md:inset-x-auto md:left-auto md:right-0 md:top-[calc(100%+0.5rem)] md:mt-0 md:max-h-[min(50vh,22rem)] md:w-[min(calc(100vw-2rem),20rem)]"
          role="dialog"
          aria-label="Dine ligachatter"
        >
          <p className="border-b border-slate-100 px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ligachatter
          </p>
          <div className="max-h-[min(58dvh,20rem)] overflow-y-auto px-1 py-1 md:max-h-[min(50vh,22rem)]">
            {loading ? (
              <p className="px-3 py-4 text-center text-sm text-slate-500">Laster…</p>
            ) : rows.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-slate-500">
                Du er ikke medlem i noen liga ennå.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {rows.map((r) => {
                  const unread = computeLeagueUnread(r.leagueId, r.latest, currentUserId)
                  const unreadSuppressedForRoute =
                    dock.routeLeagueId !== null && r.leagueId === dock.routeLeagueId
                  const showUnreadDot = unread && !unreadSuppressedForRoute
                  return (
                    <li key={r.leagueId}>
                      <button
                        type="button"
                        onClick={() => dock.selectLeagueFromLauncher(r.leagueId, r.name)}
                        className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-slate-50"
                      >
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                            {r.name}
                          </span>
                          {showUnreadDot ? (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" title="Ulest" />
                          ) : null}
                        </span>
                        {r.latest ? (
                          <>
                            <span className="line-clamp-2 text-xs text-slate-600">
                              {previewSnippet(r.latest.content)}
                            </span>
                            <span className="text-[10px] tabular-nums text-slate-400">
                              {new Date(r.latest.created_at).toLocaleString('nb-NO', {
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">Ingen meldinger ennå</span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
