'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getProfileByUserId, profileHasUsername } from '@/lib/profiles'

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

/** Same markup as the dedicated `/league/[id]/results` full view (all columns, min width, highlights). */
function LeagueResultsTable({
  rows,
  stickyHeader,
}: {
  rows: ScoreDetailRow[]
  stickyHeader: boolean
}) {
  return (
    <table className="w-full min-w-[640px] text-left text-sm">
      <thead
        className={`bg-slate-100 text-slate-700 ${
          stickyHeader
            ? 'sticky top-0 z-[1] shadow-[inset_0_-1px_0_0_rgb(226_232_240)]'
            : ''
        }`}
      >
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
            <tr key={row.id} className={`border-t border-slate-200 ${rowClass[tone]}`}>
              <td className="px-2 py-2 font-medium text-slate-900 sm:px-3">{row.team_name}</td>
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
  )
}

function ResultsLegend() {
  return (
    <p className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">
      <span>
        <span className="inline-block size-2 rounded-sm bg-emerald-400 align-middle" /> Riktig
      </span>
      <span>
        <span className="inline-block size-2 rounded-sm bg-amber-400 align-middle" /> Nær (±1–2)
      </span>
      <span>
        <span className="inline-block size-2 rounded-sm bg-red-400 align-middle" /> Langt unna
      </span>
    </p>
  )
}

type Props = {
  leagueId: string
  previewRowLimit?: number
  /** Hub: show all rows but cap visible height (~previewMaxVisibleRows) with vertical scroll */
  previewMaxVisibleRows?: number
  seeAllHref?: string
}

export function LeagueResultsSection({
  leagueId,
  previewRowLimit,
  previewMaxVisibleRows,
  seeAllHref,
}: Props) {
  const router = useRouter()
  const [rows, setRows] = useState<ScoreDetailRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const isPreview = previewRowLimit != null && previewRowLimit > 0
  const usesScrollPreview =
    isPreview && previewMaxVisibleRows != null && previewMaxVisibleRows > 0

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
      if (!profileHasUsername(profile)) {
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
        setLoading(false)
        return
      }

      const latestSeason = Math.max(...raw.map((r) => r.season))
      const forSeason = raw.filter((r) => r.season === latestSeason)
      forSeason.sort((a, b) => a.actual_position - b.actual_position)

      setRows(forSeason)
      setLoading(false)
    }

    void load()
  }, [leagueId, router])

  const empty = useMemo(() => !loading && rows.length === 0 && !error, [loading, rows.length, error])

  const displayRows = useMemo(() => {
    if (!isPreview) return rows
    if (usesScrollPreview) return rows
    return rows.slice(0, previewRowLimit)
  }, [isPreview, usesScrollPreview, previewRowLimit, rows])

  const hasMore =
    isPreview &&
    (usesScrollPreview
      ? rows.length > (previewMaxVisibleRows ?? 0)
      : rows.length > (previewRowLimit ?? 0))
  const showPreviewFooter = isPreview && seeAllHref && rows.length > 0

  /**
   * Embedded hub: ~5 data rows visible (thead + rows) with internal vertical scroll.
   * Uses one line-height–based cap so mobile/desktop stay consistent.
   */
  const embeddedScrollClass = usesScrollPreview
    ? 'max-h-[min(16.5rem,50vh)] overflow-x-auto overflow-y-auto overscroll-contain'
    : 'overflow-x-auto'

  if (loading) {
    return <p className="text-center text-sm text-slate-500">Laster resultater...</p>
  }

  if (error) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>
    )
  }

  if (empty) {
    return (
      <p className="rounded-lg bg-slate-100 px-3 py-2 text-center text-sm text-slate-600">
        Ingen poengdetaljer i denne ligaen ennå. Poeng beregnes når admin har kjørt poengberegning.
      </p>
    )
  }

  return (
    <div>
      <ResultsLegend />
      <div className={`rounded-xl border border-slate-200 ${embeddedScrollClass}`}>
        <LeagueResultsTable rows={displayRows} stickyHeader={usesScrollPreview} />
      </div>
      {showPreviewFooter ? (
        <div className="mt-3 text-center">
          <Link
            href={seeAllHref}
            prefetch
            className="text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
          >
            {hasMore ? 'Se alle resultater' : 'Åpne resultater'}
          </Link>
        </div>
      ) : null}
    </div>
  )
}
