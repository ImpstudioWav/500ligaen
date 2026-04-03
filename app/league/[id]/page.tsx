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
import { LeagueChatPanel } from '@/components/league/LeagueChatPanel'

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

function leagueStatusPillClass(status: string | number | null): string {
  const base =
    'inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs font-medium leading-none'
  const key = normalizeLeagueStatusKey(status)
  if (!key) {
    return `${base} border-slate-200/90 bg-slate-50 text-slate-500`
  }
  if (key === 'open') {
    return `${base} border-emerald-200/90 bg-emerald-50/90 text-emerald-900/85`
  }
  if (key === 'draft') {
    return `${base} border-amber-200/80 bg-amber-50/90 text-amber-900/80`
  }
  if (key === 'closed') {
    return `${base} border-slate-300/90 bg-slate-100 text-slate-700`
  }
  return `${base} border-slate-200/90 bg-slate-50 text-slate-700`
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

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <AppNav />

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <p className="text-sm">
            <Link href="/leagues" className="font-medium text-slate-900 underline">
              Tilbake til ligaer
            </Link>
          </p>

          {loading ? (
            <p className="mt-6 text-sm text-slate-500">Laster...</p>
          ) : error ? (
            <p className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : league ? (
            <div className="mt-6 space-y-5">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
                <div className="min-w-0 flex-1 space-y-5">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Din liga · oversikt
                    </p>
                    <h1 className="mt-1 text-2xl font-semibold text-slate-900">
                      {league.name || 'Liga'}
                    </h1>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-slate-600">
                      <span className="shrink-0">Status:</span>
                      <span
                        className={`${leagueStatusPillClass(league.status)} min-w-0 truncate`}
                      >
                        {leagueStatusLabel(league.status)}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-slate-800">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                        <span className="shrink-0 text-slate-600">Ligakode:</span>
                        <span className="inline-flex max-w-full min-w-0 items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-sm font-semibold tracking-wide text-slate-900">
                          <span className="truncate">
                            {league.join_code?.trim() ? league.join_code.trim() : '—'}
                          </span>
                        </span>
                        {league.join_code?.trim() ? (
                          <button
                            type="button"
                            onClick={() => void handleCopyJoinCode()}
                            className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100"
                          >
                            {joinCodeCopied ? 'Kopiert!' : 'Kopier'}
                          </button>
                        ) : null}
                      </div>
                      {isAdmin ? (
                        <p className="mt-1.5 text-xs text-slate-500">
                          Del koden med nye medlemmer.
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 shadow-sm ring-1 ring-slate-900/5 lg:hidden">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Din plassering
                    </p>
                    <div className="mt-3 flex items-end justify-between gap-6">
                      <div>
                        <p className="text-xs text-slate-500">Rank</p>
                        <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">
                          {myLeagueSummary != null ? `#${myLeagueSummary.rank}` : '—'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500">Poeng</p>
                        <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">
                          {myLeagueSummary != null ? myLeagueSummary.points : '—'}
                        </p>
                      </div>
                    </div>
                    {myLeagueSummary == null && hubLeaderboardRows.length > 0 ? (
                      <p className="mt-2 text-xs text-slate-500">Ikke på poenglisten ennå</p>
                    ) : null}
                    {hubLeaderboardRows.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">Ingen poeng i ligaen ennå</p>
                    ) : null}
                  </div>
                </div>

                <aside className="hidden shrink-0 lg:block lg:w-56 xl:w-64">
                  <div className="rounded-xl border border-slate-900/20 bg-slate-900 px-4 py-4 text-white shadow-md">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Din plassering
                    </p>
                    <div className="mt-4 flex items-end justify-between gap-4">
                      <div>
                        <p className="text-xs text-slate-400">Rank</p>
                        <p className="mt-1 text-3xl font-bold leading-none tabular-nums">
                          {myLeagueSummary != null ? `#${myLeagueSummary.rank}` : '—'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-400">Poeng</p>
                        <p className="mt-1 text-3xl font-bold leading-none tabular-nums">
                          {myLeagueSummary != null ? myLeagueSummary.points : '—'}
                        </p>
                      </div>
                    </div>
                    {myLeagueSummary == null && hubLeaderboardRows.length > 0 ? (
                      <p className="mt-3 text-xs leading-snug text-slate-400">
                        Ikke på poenglisten ennå
                      </p>
                    ) : null}
                    {hubLeaderboardRows.length === 0 ? (
                      <p className="mt-3 text-xs text-slate-400">Ingen poeng i ligaen ennå</p>
                    ) : null}
                  </div>
                </aside>
              </div>

              <div>
                <Link
                  href={`/league/${leagueId}/predictions`}
                  prefetch
                  className="block w-full rounded-xl bg-slate-900 py-3 text-center text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  Gå til prediksjoner
                </Link>
                {hubPredictionLine ? (
                  <p className="mt-2 text-center text-[11px] leading-tight text-slate-500">
                    {hubPredictionLine}
                  </p>
                ) : null}
              </div>

              {isAdmin ? (
                <p className="text-center text-sm">
                  <Link
                    href={`/league/${leagueId}/admin/standings`}
                    prefetch
                    className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
                  >
                    Admin standings
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {!loading && !error && league ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start lg:gap-5">
            <div className="flex flex-col gap-4 lg:col-span-5">
              <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-sm font-medium text-slate-800">Poengliste</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Topp 5 · søk for å finne brukere på lista
                </p>
                <div className="mt-4">
                  <LeagueLeaderboardSection
                    leagueId={leagueId}
                    previewRowLimit={5}
                    seeAllHref={`/league/${leagueId}/leaderboard`}
                    injectedRows={hubLeaderboardRows}
                    enableSearch
                  />
                </div>
              </section>

              <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-sm font-medium text-slate-800">Mine resultater</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Utdrag · siste sesong
                </p>
                <div className="mt-4">
                  <LeagueResultsSection
                    leagueId={leagueId}
                    previewRowLimit={4}
                    seeAllHref={`/league/${leagueId}/results`}
                  />
                </div>
              </section>
            </div>

            <div className="flex flex-col lg:col-span-7">
              <LeagueChatPanel
                leagueId={leagueId}
                variant="hub"
                fullChatHref={`/league/${leagueId}/chat`}
              />
            </div>
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
