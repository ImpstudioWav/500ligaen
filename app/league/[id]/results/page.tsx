'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AppNav } from '@/components/AppNav'
import { getProfileByUserId } from '@/lib/profiles'

type ScoreDetailRow = {
  id: string
  team_name: string
  predicted_position: number
  actual_position: number
  gp: number
  bk: number
  bl: number
  b3: number
  total_points: number
  season: number
}

function rowHighlight(predicted: number, actual: number): 'correct' | 'close' | 'wrong' {
  if (predicted === actual) return 'correct'
  const d = Math.abs(predicted - actual)
  if (d === 1 || d === 2) return 'close'
  return 'wrong'
}

const rowClass = {
  correct: 'bg-emerald-50 ring-1 ring-emerald-200/80',
  close: 'bg-amber-50 ring-1 ring-amber-200/80',
  wrong: 'bg-red-50 ring-1 ring-red-200/80',
} as const

export default function LeagueResultsPage() {
  const params = useParams()
  const router = useRouter()
  const rawId = params?.id
  const leagueId = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : ''

  const [leagueName, setLeagueName] = useState('')
  const [rows, setRows] = useState<ScoreDetailRow[]>([])
  const [seasonLabel, setSeasonLabel] = useState<number | null>(null)
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

      const { data, error: fetchError } = await supabase
        .from('score_details')
        .select(
          'id, team_name, predicted_position, actual_position, gp, bk, bl, b3, total_points, season'
        )
        .eq('user_id', user.id)
        .eq('league_id', leagueId)

      if (fetchError) {
        setError(fetchError.message)
        setLoading(false)
        return
      }

      const raw = (data ?? []) as ScoreDetailRow[]
      if (raw.length === 0) {
        setRows([])
        setSeasonLabel(null)
        setLoading(false)
        return
      }

      const latestSeason = Math.max(...raw.map((r) => r.season))
      const forSeason = raw.filter((r) => r.season === latestSeason)
      forSeason.sort((a, b) => a.actual_position - b.actual_position)

      setSeasonLabel(latestSeason)
      setRows(forSeason)
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

  const empty = useMemo(() => !loading && rows.length === 0 && !error, [loading, rows.length, error])

  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-2xl space-y-4">
        <AppNav />

        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="border-b border-slate-200 px-4 py-4">
            <p className="text-sm">
              <Link
                href={leagueId ? `/league/${leagueId}` : '/leagues'}
                className="font-medium text-slate-900 underline"
              >
                Tilbake til liga
              </Link>
            </p>
            <h1 className="mt-3 text-xl font-semibold text-slate-900">{leagueName || 'Liga'}</h1>
            <p className="mt-1 text-sm text-slate-600">Mine resultater i ligaen</p>
            {seasonLabel !== null ? (
              <p className="mt-1 text-sm text-slate-500">Sesong {seasonLabel}</p>
            ) : null}
          </div>

          <section className="p-4">
            {loading ? (
              <p className="text-center text-sm text-slate-500">Laster resultater...</p>
            ) : error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
                {error}
              </p>
            ) : empty ? (
              <p className="rounded-lg bg-slate-100 px-3 py-2 text-center text-sm text-slate-600">
                Ingen poengdetaljer i denne ligaen ennå. Poeng beregnes når admin har kjørt
                poengberegning.
              </p>
            ) : (
              <>
                <p className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">
                  <span>
                    <span className="inline-block size-2 rounded-sm bg-emerald-400 align-middle" />{' '}
                    Riktig
                  </span>
                  <span>
                    <span className="inline-block size-2 rounded-sm bg-amber-400 align-middle" />{' '}
                    Nær (±1–2)
                  </span>
                  <span>
                    <span className="inline-block size-2 rounded-sm bg-red-400 align-middle" />{' '}
                    Langt unna
                  </span>
                </p>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="px-2 py-2 font-medium sm:px-3">Lag</th>
                        <th className="px-2 py-2 text-right font-medium sm:px-3">Pred.</th>
                        <th className="px-2 py-2 text-right font-medium sm:px-3">Faktisk</th>
                        <th className="px-2 py-2 text-right font-medium sm:px-3">GP</th>
                        <th className="px-2 py-2 text-right font-medium sm:px-3">BK</th>
                        <th className="px-2 py-2 text-right font-medium sm:px-3">BL</th>
                        <th className="px-2 py-2 text-right font-medium sm:px-3">B3</th>
                        <th className="px-2 py-2 text-right font-medium sm:px-3">Sum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const tone = rowHighlight(row.predicted_position, row.actual_position)
                        return (
                          <tr
                            key={row.id}
                            className={`border-t border-slate-200 ${rowClass[tone]}`}
                          >
                            <td className="px-2 py-2 font-medium text-slate-900 sm:px-3">
                              {row.team_name}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-slate-800 sm:px-3">
                              {row.predicted_position}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-slate-800 sm:px-3">
                              {row.actual_position}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums sm:px-3">{row.gp}</td>
                            <td className="px-2 py-2 text-right tabular-nums sm:px-3">{row.bk}</td>
                            <td className="px-2 py-2 text-right tabular-nums sm:px-3">{row.bl}</td>
                            <td className="px-2 py-2 text-right tabular-nums sm:px-3">{row.b3}</td>
                            <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-900 sm:px-3">
                              {row.total_points}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
