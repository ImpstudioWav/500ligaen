'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AppNav } from '@/components/AppNav'
import { getProfileByUserId } from '@/lib/profiles'
import { predictionHubStatusLine } from '@/lib/prediction-window'

type LeagueRow = {
  name: string | null
  status: string | number | null
  join_code: string | null
  prediction_open_at: string | null
  prediction_close_at: string | null
}

type HubLink =
  | { href: string; label: string; description: string }
  | { href: string; label: string; description: string; adminOnly: true }

function formatMemberLine(count: number): string {
  return count === 1 ? '1 medlem' : `${count} medlemmer`
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

const HUB_LINKS: HubLink[] = [
  {
    href: 'predictions',
    label: 'Prediksjoner',
    description: 'Sett opp tabelltipset ditt',
  },
  {
    href: 'leaderboard',
    label: 'Leaderboard',
    description: 'Poengliste for ligaen',
  },
  {
    href: 'results',
    label: 'Resultater',
    description: 'Dine detaljpoeng per lag',
  },
  {
    href: 'chat',
    label: 'Chat',
    description: 'Snakk med ligaen',
  },
  {
    href: 'admin/standings',
    label: 'Admin standings',
    description: 'Faktisk tabell og poengberegning',
    adminOnly: true,
  },
]

export default function LeagueDetailPage() {
  const params = useParams()
  const router = useRouter()
  const rawId = params?.id
  const leagueId = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [league, setLeague] = useState<LeagueRow | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [clockTick, setClockTick] = useState(0)
  const [joinCodeCopied, setJoinCodeCopied] = useState(false)
  const joinCodeCopyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setJoinCodeCopied(false)
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
      setMemberCount(null)

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

      const [leagueRes, membersCountRes] = await Promise.all([
        supabase
          .from('leagues')
          .select('name, status, join_code, prediction_open_at, prediction_close_at')
          .eq('id', leagueId)
          .maybeSingle(),
        supabase
          .from('league_members')
          .select('*', { count: 'exact', head: true })
          .eq('league_id', leagueId),
      ])

      const { data, error: fetchError } = leagueRes
      const { count: rawMemberCount, error: countError } = membersCountRes

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
      setMemberCount(countError ? null : (rawMemberCount ?? 0))
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

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-md space-y-3">
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
            <div className="mt-6 space-y-6">
              <div className="rounded-2xl bg-gradient-to-b from-slate-50 to-white px-1 py-1">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Din liga · hjem
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
                {memberCount !== null ? (
                  <p className="mt-1 text-xs text-slate-500">{formatMemberLine(memberCount)}</p>
                ) : null}
                <div className="mt-2 text-sm text-slate-800">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                    <span className="shrink-0 text-slate-600">Join-kode:</span>
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
                <p className="mt-3 text-sm text-slate-600">
                  Velg hva du vil gjøre i ligaen — prediksjoner, poeng, chat og mer.
                </p>
              </div>

              <div>
                <h2 className="text-sm font-medium text-slate-800">Snarveier</h2>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {HUB_LINKS.filter((item) => ('adminOnly' in item ? isAdmin : true)).map(
                    (item) => {
                      const href = `/league/${leagueId}/${item.href}`
                      const fullWidthAdmin = item.href === 'admin/standings'
                      const hubLine =
                        item.href === 'predictions'
                          ? predictionHubStatusLine(
                              league.prediction_open_at ?? null,
                              league.prediction_close_at ?? null,
                              now
                            )
                          : null
                      return (
                        <li
                          key={item.href}
                          className={`min-w-0 ${fullWidthAdmin ? 'sm:col-span-2' : ''}`}
                        >
                          <Link
                            href={href}
                            prefetch
                            className="flex min-h-[4.25rem] flex-col justify-center rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                          >
                            <span className="font-medium text-slate-900">{item.label}</span>
                            <span className="mt-0.5 text-xs text-slate-600">{item.description}</span>
                            {hubLine ? (
                              <span className="mt-1 block truncate text-[11px] leading-tight text-slate-500">
                                {hubLine}
                              </span>
                            ) : null}
                          </Link>
                        </li>
                      )
                    }
                  )}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  )
}
