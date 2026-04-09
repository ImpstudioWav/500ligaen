'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AppNav } from '@/components/AppNav'
import { GlobalChatPanel } from '@/components/GlobalChatPanel'
import { getProfileByUserId, profileHasUsername } from '@/lib/profiles'

type LeagueSummary = {
  id: string
  name: string
  status: string
}

/** Display-only: translate known English status values for cards */
function leagueCardStatusLabel(status: string): string {
  const raw = status?.trim()
  if (!raw) return '—'
  if (raw.toLowerCase() === 'open') return 'åpen'
  return raw
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
}

export default function LeaguesPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [leagues, setLeagues] = useState<LeagueSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)

  const refreshLeagues = useCallback(async (uid: string) => {
    const { data: members, error: membersError } = await supabase
      .from('league_members')
      .select('league_id')
      .eq('user_id', uid)

    if (membersError) {
      setError(membersError.message)
      setLeagues([])
      return
    }

    const ids = [...new Set((members ?? []).map((m) => m.league_id).filter(Boolean))]
    if (ids.length === 0) {
      setLeagues([])
      return
    }

    const { data: leagueRows, error: leaguesError } = await supabase
      .from('leagues')
      .select('id, name, status')
      .in('id', ids)

    if (leaguesError) {
      setError(leaguesError.message)
      setLeagues([])
      return
    }

    setLeagues((leagueRows ?? []) as LeagueSummary[])
  }, [])

  useEffect(() => {
    const init = async () => {
      setError('')
      setMessage('')

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

      setIsAdmin(profile.is_admin === true)
      setUserId(user.id)
      await refreshLeagues(user.id)
      if (
        typeof window !== 'undefined' &&
        sessionStorage.getItem('leagueDeletedOk') === '1'
      ) {
        sessionStorage.removeItem('leagueDeletedOk')
        setMessage('Ligaen ble slettet.')
      }
      setLoading(false)
    }

    void init()

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
  }, [router, refreshLeagues])

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')

    if (!userId) return

    const code = joinCode.trim()
    if (!code) {
      setError('Skriv inn en ligakode.')
      return
    }

    setJoining(true)

    const { data: league, error: lookupError } = await supabase
      .from('leagues')
      .select('id')
      .eq('join_code', code)
      .maybeSingle()

    if (lookupError) {
      setJoining(false)
      setError(lookupError.message)
      return
    }

    if (!league) {
      setJoining(false)
      setError('Finner ingen liga med denne koden.')
      return
    }

    const { data: existing } = await supabase
      .from('league_members')
      .select('league_id')
      .eq('user_id', userId)
      .eq('league_id', league.id)
      .maybeSingle()

    if (existing) {
      setJoining(false)
      setError('Du er allerede medlem av denne ligaen.')
      return
    }

    const { error: insertError } = await supabase.from('league_members').insert({
      league_id: league.id,
      user_id: userId,
    })

    setJoining(false)

    if (insertError) {
      if (isUniqueViolation(insertError)) {
        setError('Du er allerede medlem av denne ligaen.')
      } else {
        setError(insertError.message)
      }
      return
    }

    setJoinCode('')
    setMessage('Du ble med i ligaen.')
    await refreshLeagues(userId)
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <AppNav />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr] lg:items-stretch lg:gap-5">
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h1 className="text-2xl font-semibold text-slate-900">Ligaer</h1>
                  <p className="mt-1 text-sm text-slate-600">Bli med i en liga med ligakode.</p>
                </div>
                {!loading && isAdmin ? (
                  <Link
                    href="/admin/leagues/new"
                    prefetch
                    className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
                  >
                    Opprett liga
                  </Link>
                ) : null}
              </div>

              {loading ? (
                <p className="mt-6 text-sm text-slate-500">Laster...</p>
              ) : (
                <div className="mt-6 space-y-6">
                  {leagues.length === 0 ? (
                    <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      Du er ikke med i noen ligaer ennå
                    </p>
                  ) : (
                    <div>
                      <h2 className="text-sm font-medium text-slate-800">Dine ligaer</h2>
                      <ul className="mt-2 space-y-2">
                        {leagues.map((lg) => (
                          <li key={lg.id}>
                            <Link
                              href={`/league/${lg.id}`}
                              className="block rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 transition hover:border-slate-300 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                            >
                              <p className="font-medium text-slate-900">{lg.name || 'Liga'}</p>
                              <p className="mt-0.5 text-sm text-slate-600">
                                Status:{' '}
                                <span className="text-slate-800">
                                  {lg.status != null && lg.status !== ''
                                    ? leagueCardStatusLabel(lg.status)
                                    : '—'}
                                </span>
                              </p>
                              <p className="mt-1.5 text-xs text-slate-500">Trykk for å åpne liga</p>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <form onSubmit={handleJoin} className="space-y-4 border-t border-slate-100 pt-6">
                    <div>
                      <label
                        htmlFor="join-code"
                        className="mb-1 block text-sm font-medium text-slate-700"
                      >
                        Ligakode
                      </label>
                      <input
                        id="join-code"
                        type="text"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value)}
                        autoComplete="off"
                        disabled={joining}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                        placeholder="Lim inn ligakode her"
                      />
                    </div>

                    {error ? (
                      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
                    ) : null}
                    {message ? (
                      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                        {message}
                      </p>
                    ) : null}

                    <button
                      type="submit"
                      disabled={joining}
                      className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {joining ? 'Bli med...' : 'Bli med i liga'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>

          {!loading ? (
            <div className="flex min-w-0 flex-col">
              <div className="flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
                <div className="flex shrink-0 flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-medium text-slate-800">500ligaen · global chat</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Siste 50 meldinger (forhåndsvisning)
                    </p>
                  </div>
                  <Link
                    href="/chat"
                    prefetch
                    className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-100"
                  >
                    Full global chat
                  </Link>
                </div>
                <div className="mt-4">
                  <GlobalChatPanel previewMessageLimit={50} />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  )
}
