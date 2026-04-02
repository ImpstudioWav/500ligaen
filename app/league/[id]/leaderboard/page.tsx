'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AppNav } from '@/components/AppNav'
import { getProfileByUserId, getUsernameMap, shortenUserId } from '@/lib/profiles'

type LeaderboardRow = {
  id: string
  user_id: string
  points: number
  updated_at: string
}

export default function LeagueLeaderboardPage() {
  const params = useParams()
  const router = useRouter()
  const rawId = params?.id
  const leagueId = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : ''

  const [leagueName, setLeagueName] = useState('')
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [usernameMap, setUsernameMap] = useState<Record<string, string>>({})
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
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

      const { data: leagueRow, error: leagueError } = await supabase
        .from('leagues')
        .select('name')
        .eq('id', leagueId)
        .maybeSingle()

      if (leagueError) {
        setError(leagueError.message)
        setLoading(false)
        return
      }

      if (!leagueRow) {
        setError('Fant ikke ligaen.')
        setLoading(false)
        return
      }

      setLeagueName((leagueRow as { name: string | null }).name || 'Liga')

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

      const fetchedRows = (data ?? []) as LeaderboardRow[]
      setRows(fetchedRows)
      const usernames = await getUsernameMap(fetchedRows.map((row) => row.user_id))
      setUsernameMap(usernames)
      setLoading(false)
    }

    void load()

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
  }, [leagueId, router])

  const rankedRows = useMemo(
    () => rows.map((row, index) => ({ rank: index + 1, ...row })),
    [rows]
  )

  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        <AppNav />

        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="border-b border-slate-200 px-4 py-4 text-center sm:text-left">
            <p className="text-sm">
              <Link
                href={leagueId ? `/league/${leagueId}` : '/leagues'}
                className="font-medium text-slate-900 underline"
              >
                Tilbake til liga
              </Link>
            </p>
            <h1 className="mt-3 text-xl font-semibold text-slate-900">
              {loading ? 'Leaderboard' : leagueName}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Ligaens poengliste — sortert etter poeng (høyeste først)
            </p>
          </div>

          <section className="p-4">
            {loading ? (
              <p className="text-center text-sm text-slate-500">Laster leaderboard...</p>
            ) : error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
                {error}
              </p>
            ) : rankedRows.length === 0 ? (
              <p className="rounded-lg bg-slate-100 px-3 py-2 text-center text-sm text-slate-600">
                Ingen poeng i denne ligaen ennå. Når resultater er beregnet, dukker listen opp her.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[280px] text-left text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="w-14 px-3 py-3 font-medium">Rank</th>
                      <th className="px-3 py-3 font-medium">Bruker</th>
                      <th className="w-20 px-3 py-3 text-right font-medium">Poeng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankedRows.map((row) => {
                      const isYou = currentUserId !== null && row.user_id === currentUserId
                      return (
                        <tr
                          key={row.id}
                          className={`border-t border-slate-200 ${
                            isYou ? 'bg-slate-900/[0.06]' : 'bg-white'
                          }`}
                        >
                          <td className="px-3 py-3 font-medium text-slate-900">{row.rank}</td>
                          <td className="px-3 py-3 text-slate-800">
                            <span className={isYou ? 'font-semibold text-slate-900' : ''}>
                              {usernameMap[row.user_id] ?? shortenUserId(row.user_id)}
                            </span>
                            {isYou ? (
                              <span className="ml-2 rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                                Deg
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">
                            {row.points}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
