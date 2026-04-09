'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AppNav } from '@/components/AppNav'
import { getProfileByUserId, profileHasUsername } from '@/lib/profiles'
import { LeagueResultsSection } from '@/components/league/LeagueResultsSection'

export default function LeagueResultsPage() {
  const params = useParams()
  const router = useRouter()
  const rawId = params?.id
  const leagueId = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : ''

  const [leagueName, setLeagueName] = useState('')
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
          </div>

          <section className="p-4">
            {loading || error ? (
              loading ? (
                <p className="text-center text-sm text-slate-500">Laster...</p>
              ) : (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
                  {error}
                </p>
              )
            ) : (
              <LeagueResultsSection leagueId={leagueId} />
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
