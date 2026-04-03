'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  type ChatUserInfo,
  getProfileByUserId,
  getUsernameMap,
  shortenUserId,
} from '@/lib/profiles'

export type LeagueLeaderboardRow = {
  id: string
  user_id: string
  points: number
  updated_at: string
}

type Props = {
  leagueId: string
  /** First N rows only when search is empty; with search text, all matches are shown */
  previewRowLimit?: number
  seeAllHref?: string
  /** When set, skips leaderboard fetch (hub supplies rows from page load) */
  injectedRows?: LeagueLeaderboardRow[]
  /** Show username search (hub preview) */
  enableSearch?: boolean
}

export function LeagueLeaderboardSection({
  leagueId,
  previewRowLimit,
  seeAllHref,
  injectedRows,
  enableSearch,
}: Props) {
  const router = useRouter()
  const [rows, setRows] = useState<LeagueLeaderboardRow[]>([])
  const [usernameMap, setUsernameMap] = useState<Record<string, ChatUserInfo>>({})
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const isPreview = previewRowLimit != null && previewRowLimit > 0
  const usesInjection = injectedRows !== undefined

  useEffect(() => {
    if (usesInjection) return

    const load = async () => {
      setLoading(true)
      setError('')

      if (!leagueId) {
        setError('Ugyldig liga.')
        setLoading(false)
        return
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.replace('/login')
        return
      }

      const profile = await getProfileByUserId(user.id)
      if (!profile) {
        router.replace('/complete-profile')
        return
      }

      const { data: membership, error: memberError } = await supabase
        .from('league_members')
        .select('league_id')
        .eq('user_id', user.id)
        .eq('league_id', leagueId)
        .maybeSingle()

      if (memberError) {
        setError(memberError.message)
        setLoading(false)
        return
      }

      if (!membership) {
        router.replace('/leagues')
        return
      }

      setCurrentUserId(user.id)

      const { data, error: leaderboardError } = await supabase
        .from('leaderboard')
        .select('id, user_id, points, updated_at')
        .eq('league_id', leagueId)
        .order('points', { ascending: false })
        .order('updated_at', { ascending: true })

      if (leaderboardError) {
        setError(leaderboardError.message)
        setLoading(false)
        return
      }

      const fetchedRows = (data ?? []) as LeagueLeaderboardRow[]
      setRows(fetchedRows)
      const usernames = await getUsernameMap(fetchedRows.map((row) => row.user_id))
      setUsernameMap(usernames)
      setLoading(false)
    }

    void load()
  }, [leagueId, router, usesInjection])

  useEffect(() => {
    if (!usesInjection) return

    let cancelled = false

    const sync = async () => {
      setLoading(true)
      setError('')

      if (!leagueId) {
        setError('Ugyldig liga.')
        setLoading(false)
        return
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.replace('/login')
        return
      }

      if (cancelled) return

      const profile = await getProfileByUserId(user.id)
      if (!profile) {
        router.replace('/complete-profile')
        return
      }

      if (cancelled) return

      const { data: membership, error: memberError } = await supabase
        .from('league_members')
        .select('league_id')
        .eq('user_id', user.id)
        .eq('league_id', leagueId)
        .maybeSingle()

      if (memberError) {
        if (!cancelled) {
          setError(memberError.message)
          setLoading(false)
        }
        return
      }

      if (!membership) {
        router.replace('/leagues')
        return
      }

      if (cancelled) return

      setCurrentUserId(user.id)
      setRows(injectedRows ?? [])
      const usernames = await getUsernameMap((injectedRows ?? []).map((row) => row.user_id))
      if (!cancelled) {
        setUsernameMap(usernames)
        setLoading(false)
      }
    }

    void sync()

    return () => {
      cancelled = true
    }
  }, [usesInjection, injectedRows, leagueId, router])

  const rankedRows = useMemo(
    () => rows.map((row, index) => ({ rank: index + 1, ...row })),
    [rows]
  )

  const searchTrimmed = searchQuery.trim()
  const isSearching = searchTrimmed.length > 0

  const displayRows = useMemo(() => {
    let list = rankedRows
    if (isSearching) {
      const q = searchTrimmed.toLowerCase()
      list = rankedRows.filter((row) => {
        const label = (
          usernameMap[row.user_id]?.username ?? shortenUserId(row.user_id)
        ).toLowerCase()
        return label.includes(q)
      })
    } else if (isPreview && previewRowLimit) {
      list = rankedRows.slice(0, previewRowLimit)
    }
    return list
  }, [rankedRows, isSearching, searchTrimmed, isPreview, previewRowLimit, usernameMap])

  const hasMore =
    !isSearching && isPreview && rankedRows.length > (previewRowLimit ?? 0)

  const cellPad = isPreview ? 'px-2.5 py-2' : 'px-3 py-3'
  const showPreviewFooter =
    !isSearching && isPreview && seeAllHref && rankedRows.length > 0

  if (loading) {
    return <p className="text-center text-sm text-slate-500">Laster leaderboard...</p>
  }

  if (error) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>
    )
  }

  if (rankedRows.length === 0) {
    return (
      <p className="rounded-lg bg-slate-100 px-3 py-2 text-center text-sm text-slate-600">
        Ingen poeng i denne ligaen ennå. Når resultater er beregnet, dukker listen opp her.
      </p>
    )
  }

  return (
    <div>
      {enableSearch ? (
        <div className="mb-3">
          <label htmlFor={`lb-search-${leagueId}`} className="sr-only">
            Søk bruker
          </label>
          <input
            id={`lb-search-${leagueId}`}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Søk bruker…"
            autoComplete="off"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-200"
          />
        </div>
      ) : null}

      {isSearching && displayRows.length === 0 ? (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-center text-sm text-slate-600">
          Ingen treff for «{searchTrimmed}».
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[260px] text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className={`w-12 ${cellPad} text-xs font-medium sm:text-sm`}>Rank</th>
                <th className={`${cellPad} text-xs font-medium sm:text-sm`}>Bruker</th>
                <th className={`w-16 ${cellPad} text-right text-xs font-medium sm:text-sm`}>
                  Poeng
                </th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => {
                const isYou = currentUserId !== null && row.user_id === currentUserId
                return (
                  <tr
                    key={row.id}
                    className={`border-t border-slate-200 ${
                      isYou ? 'bg-slate-900/[0.06]' : 'bg-white'
                    }`}
                  >
                    <td className={`${cellPad} font-medium text-slate-900`}>{row.rank}</td>
                    <td className={`${cellPad} text-slate-800`}>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <span
                          className={`min-w-0 truncate ${isYou ? 'font-semibold text-slate-900' : ''}`}
                        >
                          {usernameMap[row.user_id]?.username ?? shortenUserId(row.user_id)}
                        </span>
                        {isYou ? (
                          <span className="shrink-0 rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                            Deg
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className={`${cellPad} text-right font-semibold tabular-nums text-slate-900`}>
                      {row.points}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showPreviewFooter ? (
        <div className="mt-3 text-center">
          <Link
            href={seeAllHref}
            prefetch
            className="text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
          >
            {hasMore ? 'Se full poengliste' : 'Åpne poengliste'}
          </Link>
        </div>
      ) : null}
    </div>
  )
}
