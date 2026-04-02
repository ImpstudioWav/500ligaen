'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AppNav } from '@/components/AppNav'
import { getProfileByUserId } from '@/lib/profiles'

export default function LeaderboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const check = async () => {
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

      setLoading(false)
    }

    void check()

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
    <main className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        <AppNav />

        <div className="rounded-2xl bg-white px-4 py-8 text-center shadow-sm ring-1 ring-slate-200 sm:text-left">
          <h1 className="text-xl font-semibold text-slate-900">Leaderboard</h1>
          {loading ? (
            <p className="mt-4 text-sm text-slate-500">Laster...</p>
          ) : (
            <>
              <p className="mt-4 text-sm text-slate-700">
                Velg en liga for å se leaderboard.
              </p>
              <p className="mt-4">
                <Link
                  href="/leagues"
                  className="inline-flex rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  Gå til ligaer
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
