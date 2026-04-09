'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AppNav } from '@/components/AppNav'
import { getProfileByUserId } from '@/lib/profiles'
import { predictionHubStatusLine } from '@/lib/prediction-window'
import {
  LeagueLeaderboardSection,
  type LeagueLeaderboardRow,
} from '@/components/league/LeagueLeaderboardSection'
import { LeagueResultsSection } from '@/components/league/LeagueResultsSection'

type LeagueRow = {
  name: string | null
  status: string | number | null
  join_code: string | null
  prediction_open_at: string | null
  prediction_close_at: string | null
}

function normalizeLeagueStatusKey(status: string | number | null): string | null {
  if (status == null) return null
  const s = String(status).trim().toLowerCase()
  return s.length ? s : null
}

/** User-facing label; unknown values fall back to the stored string. */
function leagueStatusLabel(status: string | number | null): string {
  const key = normalizeLeagueStatusKey(status)
  if (!key) return '—'
  const map: Record<string, string> = {
    open: 'Åpen',
    draft: 'Utkast',
    closed: 'Stengt',
  }
  return (map[key] ?? String(status).trim()) || '—'
}

/** Status pill for `bg-slate-900` league overview widget (matches dark placement card). */
function leagueStatusPillClassDark(status: string | number | null): string {
  const base =
    'inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs font-medium leading-none'
  const key = normalizeLeagueStatusKey(status)
  if (!key) {
    return `${base} border-slate-500/50 bg-white/5 text-slate-300`
  }
  if (key === 'open') {
    return `${base} border-emerald-400/35 bg-emerald-400/10 text-emerald-100`
  }
  if (key === 'draft') {
    return `${base} border-amber-400/35 bg-amber-400/10 text-amber-100`
  }
  if (key === 'closed') {
    return `${base} border-slate-400/35 bg-white/10 text-slate-200`
  }
  return `${base} border-slate-500/50 bg-white/10 text-slate-200`
}

export default function LeagueDetailPage() {
  const params = useParams()
  const router = useRouter()
  const rawId = params?.id
  const leagueId = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [league, setLeague] = useState<LeagueRow | null>(null)
  const [hubLeaderboardRows, setHubLeaderboardRows] = useState<LeagueLeaderboardRow[]>([])
  const [myLeagueSummary, setMyLeagueSummary] = useState<{
    rank: number
    points: number
  } | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [clockTick, setClockTick] = useState(0)
  const [joinCodeCopied, setJoinCodeCopied] = useState(false)
  const joinCodeCopyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [deleteLeagueError, setDeleteLeagueError] = useState('')
  const [deletingLeague, setDeletingLeague] = useState(false)
  const [deleteTypeConfirm, setDeleteTypeConfirm] = useState('')

  useEffect(() => {
    setJoinCodeCopied(false)
    setDeleteTypeConfirm('')
    setDeleteLeagueError('')
    if (joinCodeCopyResetRef.current) {
      clearTimeout(joinCodeCopyResetRef.current)
      joinCodeCopyResetRef.current = null
    }
  }, [leagueId])

  useEffect(() => {
    return () => {
      if (joinCodeCopyResetRef.current) {
        clearTimeout(joinCodeCopyResetRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setClockTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const now = useMemo(() => new Date(), [clockTick])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      setHubLeaderboardRows([])
      setMyLeagueSummary(null)

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

      setIsAdmin(profile.is_admin === true)

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

      const [leagueRes, leaderboardRes] = await Promise.all([
        supabase
          .from('leagues')
          .select('name, status, join_code, prediction_open_at, prediction_close_at')
          .eq('id', leagueId)
          .maybeSingle(),
        supabase
          .from('leaderboard')
          .select('id, user_id, points, updated_at')
          .eq('league_id', leagueId)
          .order('points', { ascending: false })
          .order('updated_at', { ascending: true }),
      ])

      const { data, error: fetchError } = leagueRes
      const { data: lbData, error: lbError } = leaderboardRes

      if (fetchError) {
        setError(fetchError.message)
        setLoading(false)
        return
      }

      if (!data) {
        setError('Fant ikke ligaen.')
        setLoading(false)
        return
      }

      setLeague(data as LeagueRow)

      const lbRows =
        !lbError && lbData ? (lbData as LeagueLeaderboardRow[]) : []
      setHubLeaderboardRows(lbRows)
      const myIndex = lbRows.findIndex((r) => r.user_id === user.id)
      setMyLeagueSummary(
        myIndex >= 0
          ? { rank: myIndex + 1, points: lbRows[myIndex].points }
          : null
      )

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

  const handleDeleteLeague = async () => {
    if (!leagueId || !league) return
    if (deleteTypeConfirm !== 'DELETE') return

    const name = (league.name || 'Liga').trim()
    const ok = window.confirm(
      `Slette «${name}»?\n\nLigaen og all tilhørende data (medlemmer, meldinger, prediksjoner, poeng m.m.) blir permanent slettet. Dette kan ikke angres.`
    )
    if (!ok) return

    setDeleteLeagueError('')
    setDeletingLeague(true)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        setDeleteLeagueError('Fant ikke innlogging. Prøv å logge inn på nytt.')
        setDeletingLeague(false)
        return
      }

      const res = await fetch('/api/admin/delete-league', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ leagueId }),
      })

      const payload = (await res.json().catch(() => ({}))) as { error?: string }

      if (!res.ok) {
        setDeleteLeagueError(payload.error || `Kunne ikke slette (HTTP ${res.status}).`)
        setDeletingLeague(false)
        return
      }

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('leagueDeletedOk', '1')
      }
      router.push('/leagues')
    } catch {
      setDeleteLeagueError('Nettverksfeil ved sletting. Prøv igjen.')
      setDeletingLeague(false)
    }
  }

  const handleCopyJoinCode = async () => {
    const code = league?.join_code?.trim()
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      if (joinCodeCopyResetRef.current) {
        clearTimeout(joinCodeCopyResetRef.current)
      }
      setJoinCodeCopied(true)
      joinCodeCopyResetRef.current = setTimeout(() => {
        setJoinCodeCopied(false)
        joinCodeCopyResetRef.current = null
      }, 2000)
    } catch {
      // Clipboard kan feile (f.eks. uten tillatelse); ignorer stille.
    }
  }

  const hubPredictionLine = league
    ? predictionHubStatusLine(
        league.prediction_open_at ?? null,
        league.prediction_close_at ?? null,
        now
      )
    : null

  const hubLeaderboardAndResults = (
    <>
      <section className="flex min-h-0 flex-col rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:rounded-2xl sm:p-4">
        <h2 className="text-sm font-medium text-slate-800">Poengliste</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Søk · hele poenglista · rull for flere
        </p>
        <div className="mt-2 min-h-0 flex-1 sm:mt-3 lg:mt-4">
          <LeagueLeaderboardSection
            leagueId={leagueId}
            previewRowLimit={5}
            previewMaxVisibleRows={5}
            seeAllHref={`/league/${leagueId}/leaderboard`}
            injectedRows={hubLeaderboardRows}
            enableSearch
          />
        </div>
      </section>

      <section className="flex min-h-0 flex-col rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:rounded-2xl sm:p-4">
        <h2 className="text-sm font-medium text-slate-800">Mine resultater</h2>
        <div className="mt-2 min-h-0 sm:mt-3 lg:mt-4">
          <LeagueResultsSection
            leagueId={leagueId}
            previewRowLimit={5}
            previewMaxVisibleRows={5}
            seeAllHref={`/league/${leagueId}/results`}
          />
        </div>
      </section>
    </>
  )

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-3 sm:px-4 sm:py-6">
      <div className="mx-auto w-full max-w-4xl space-y-3 sm:space-y-4 lg:max-w-6xl">
        <AppNav />

        <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:rounded-2xl sm:p-4 lg:p-5">
          <p className="text-sm leading-tight">
            <Link href="/leagues" className="font-medium text-slate-900 underline">
              Tilbake til ligaer
            </Link>
          </p>

          {loading ? (
            <p className="mt-2 text-sm text-slate-500 sm:mt-4 lg:mt-6">Laster...</p>
          ) : error ? (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:mt-4 lg:mt-6">{error}</p>
          ) : league ? (
            <div className="mt-1.5 space-y-1.5 sm:mt-2 sm:space-y-2 lg:mt-3 lg:space-y-3">
              {/*
                Mobile: compact matching max-w cards; lg: fixed equal width (15rem), start-aligned / end-aligned, no vertical stretch.
              */}
              <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 lg:grid-cols-[1fr_auto_1fr] lg:items-start lg:gap-x-3 lg:gap-y-0 xl:gap-x-4">
                <div className="col-start-1 row-start-1 flex min-h-0 min-w-0 justify-start lg:col-span-1 lg:row-start-1">
                  <div className="flex w-full max-w-[12rem] flex-col rounded-lg border border-slate-900/20 bg-slate-900 px-2.5 py-2 text-white shadow-md sm:px-3 sm:py-2.5 lg:w-[15rem] lg:max-w-[15rem] lg:shrink-0 lg:px-3 lg:py-2.5">
                    <h1 className="text-base font-semibold leading-snug text-white sm:text-[1.0625rem] lg:text-lg">
                      {league.name || 'Liga'}
                    </h1>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
                      <span
                        className={`${leagueStatusPillClassDark(league.status)} min-w-0 max-w-full truncate`}
                      >
                        {leagueStatusLabel(league.status)}
                      </span>
                    </div>
                    <div className="mt-1.5 text-xs">
                      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                        <span className="shrink-0 text-slate-400">Ligakode:</span>
                        <span className="inline-flex min-w-0 max-w-[min(100%,7.5rem)] items-center rounded-full border-2 border-white bg-white px-1.5 py-px font-mono text-[11px] font-bold tracking-wide text-slate-900 shadow-sm sm:max-w-[9rem] lg:max-w-[10.5rem]">
                          <span className="truncate">
                            {league.join_code?.trim() ? league.join_code.trim() : '—'}
                          </span>
                        </span>
                        {league.join_code?.trim() ? (
                          <button
                            type="button"
                            onClick={() => void handleCopyJoinCode()}
                            className="shrink-0 rounded-full border-2 border-white/50 bg-white/10 px-1.5 py-px text-[11px] font-medium text-white transition hover:border-white/70 hover:bg-white/15 active:bg-white/20"
                          >
                            {joinCodeCopied ? 'Kopiert!' : 'Kopier'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="col-start-2 row-start-1 flex min-h-0 min-w-0 justify-end lg:hidden">
                  <div className="flex w-full max-w-[12rem] flex-col rounded-lg border border-slate-900/20 bg-slate-900 px-2.5 py-2 text-white shadow-md sm:px-3 sm:py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Din plassering
                    </p>
                    <div className="mt-2 flex items-end justify-between gap-2">
                      <div>
                        <p className="text-[11px] text-slate-400">Rank</p>
                        <p className="mt-0.5 text-xl font-bold leading-none tabular-nums">
                          {myLeagueSummary != null ? `#${myLeagueSummary.rank}` : '—'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-slate-400">Poeng</p>
                        <p className="mt-0.5 text-xl font-bold leading-none tabular-nums">
                          {myLeagueSummary != null ? myLeagueSummary.points : '—'}
                        </p>
                      </div>
                    </div>
                  {myLeagueSummary == null && hubLeaderboardRows.length > 0 ? (
                    <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
                      Ikke på poenglisten ennå
                    </p>
                  ) : null}
                  {hubLeaderboardRows.length === 0 ? (
                    <p className="mt-1.5 text-[11px] text-slate-400">Ingen poeng i ligaen ennå</p>
                  ) : null}
                  </div>
                </div>

                <div className="col-span-2 row-start-2 flex justify-center py-0 max-lg:-mt-0.5 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:self-center lg:py-0">
                  <img
                    src="/500ligaen-logo.png"
                    alt="500ligaen"
                    className="h-auto w-[5.25rem] max-w-full object-contain sm:w-[5.5rem] lg:w-32 xl:w-36"
                    width={200}
                    height={67}
                    decoding="async"
                  />
                </div>

                <aside className="hidden min-h-0 min-w-0 lg:col-start-3 lg:row-start-1 lg:flex lg:w-full lg:justify-end">
                  <div className="flex w-full max-w-[12rem] flex-col rounded-lg border border-slate-900/20 bg-slate-900 px-2.5 py-2 text-white shadow-md sm:px-3 sm:py-2.5 lg:w-[15rem] lg:max-w-[15rem] lg:shrink-0 lg:px-3 lg:py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Din plassering
                    </p>
                    <div className="mt-2 flex items-end justify-between gap-2 lg:gap-3">
                      <div>
                        <p className="text-[11px] text-slate-400">Rank</p>
                        <p className="mt-0.5 text-xl font-bold leading-none tabular-nums lg:text-2xl">
                          {myLeagueSummary != null ? `#${myLeagueSummary.rank}` : '—'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-slate-400">Poeng</p>
                        <p className="mt-0.5 text-xl font-bold leading-none tabular-nums lg:text-2xl">
                          {myLeagueSummary != null ? myLeagueSummary.points : '—'}
                        </p>
                      </div>
                    </div>
                    {myLeagueSummary == null && hubLeaderboardRows.length > 0 ? (
                      <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
                        Ikke på poenglisten ennå
                      </p>
                    ) : null}
                    {hubLeaderboardRows.length === 0 ? (
                      <p className="mt-1.5 text-[11px] text-slate-400">Ingen poeng i ligaen ennå</p>
                    ) : null}
                  </div>
                </aside>
              </div>

              <div className="pt-0 max-lg:-mt-px lg:pt-0">
                <Link
                  href={`/league/${leagueId}/predictions`}
                  prefetch
                  className="block w-full rounded-lg bg-slate-900 py-2 text-center text-sm font-medium text-white transition hover:bg-slate-800 sm:rounded-xl sm:py-2.5 lg:rounded-xl lg:py-3"
                >
                  Gå til prediksjoner
                </Link>
                {hubPredictionLine ? (
                  <p className="mt-1 px-0.5 text-center text-[10px] leading-tight text-slate-500 sm:text-[11px] lg:mt-2">
                    {hubPredictionLine}
                  </p>
                ) : null}
              </div>

              {isAdmin ? (
                <p className="text-center text-[11px] sm:text-sm">
                  <Link
                    href={`/league/${leagueId}/admin/standings`}
                    prefetch
                    className="font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900 sm:text-slate-700"
                  >
                    Admin standings
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {!loading && !error && league ? (
          <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(28rem,1.55fr)] lg:items-start lg:gap-5">
            {hubLeaderboardAndResults}
          </div>
        ) : null}

        {!loading && !error && league && isAdmin ? (
          <section
            aria-label="Admin — slett liga"
            className="rounded-2xl border border-red-200/90 bg-red-50/40 p-4 sm:p-5"
          >
            <h2 className="text-sm font-semibold text-red-900">Faresone</h2>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-red-950/80">
              Sletting fjerner ligaen fra databasen. All tilhørende data slettes også — for eksempel
              medlemmer, ligachat, prediksjoner, poeng, resultater og andre rader som er koblet til
              ligaen (via sletteregler i databasen). Dette kan ikke angres.
            </p>
            <div className="mt-4 max-w-xl space-y-2">
              <label
                htmlFor="delete-league-confirm-input"
                className="block text-xs font-medium text-red-950/90"
              >
                Bekreft ved å skrive{' '}
                <span className="font-mono font-semibold tracking-wide text-red-900">DELETE</span>{' '}
                (nøyaktig disse seks bokstavene, alle store)
              </label>
              <input
                id="delete-league-confirm-input"
                type="text"
                name="delete-league-confirm"
                autoComplete="off"
                value={deleteTypeConfirm}
                onChange={(e) => {
                  setDeleteTypeConfirm(e.target.value)
                  if (deleteLeagueError) setDeleteLeagueError('')
                }}
                disabled={deletingLeague}
                placeholder="Skriv DELETE her"
                className="w-full rounded-xl border border-red-200 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:opacity-60"
              />
            </div>
            {deleteLeagueError ? (
              <p className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800">
                {deleteLeagueError}
              </p>
            ) : null}
            <button
              type="button"
              disabled={deletingLeague || deleteTypeConfirm !== 'DELETE'}
              onClick={() => void handleDeleteLeague()}
              className="mt-4 w-full rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-medium text-red-800 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {deletingLeague ? 'Sletter...' : 'Slett liga'}
            </button>
          </section>
        ) : null}
      </div>
    </main>
  )
}
