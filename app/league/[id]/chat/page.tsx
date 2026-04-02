'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AppNav } from '@/components/AppNav'
import { getProfileByUserId } from '@/lib/profiles'
import { LeagueChatPanel } from '@/components/league/LeagueChatPanel'

export default function LeagueChatPage() {
  const params = useParams()
  const router = useRouter()
  const rawId = params?.id
  const leagueId = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : ''

  const [ready, setReady] = useState(false)
  const [pageError, setPageError] = useState('')

  useEffect(() => {
    const gate = async () => {
      setPageError('')
      setReady(false)

      if (!leagueId) {
        setPageError('Ugyldig liga.')
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
        setPageError(memberError.message)
        return
      }

      if (!membership) {
        router.replace('/leagues')
        return
      }

      setReady(true)
    }

    void gate()
  }, [leagueId, router])

  useEffect(() => {
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
  }, [router])

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-md space-y-3">
        <AppNav />

        <p className="text-sm">
          <Link
            href={leagueId ? `/league/${leagueId}` : '/leagues'}
            className="font-medium text-slate-900 underline"
          >
            Tilbake til liga
          </Link>
        </p>

        {pageError ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{pageError}</p>
        ) : ready ? (
          <LeagueChatPanel leagueId={leagueId} variant="page" />
        ) : (
          <p className="text-sm text-slate-500">Laster chat...</p>
        )}
      </div>
    </main>
  )
}
