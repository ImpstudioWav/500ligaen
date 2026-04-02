'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AppNav } from '@/components/AppNav'
import { getProfileByUserId } from '@/lib/profiles'

type LeagueRow = {
  name: string | null
  status: string | number | null
}

type HubLink =
  | { href: string; label: string; description: string }
  | { href: string; label: string; description: string; adminOnly: true }

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

      const { data, error: fetchError } = await supabase
        .from('leagues')
        .select('name, status')
        .eq('id', leagueId)
        .maybeSingle()

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
                <p className="mt-2 text-sm text-slate-600">
                  Status:{' '}
                  <span className="font-medium text-slate-900">
                    {league.status != null ? String(league.status) : '—'}
                  </span>
                </p>
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
