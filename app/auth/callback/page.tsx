'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getProfileByUserId } from '@/lib/profiles'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [message, setMessage] = useState('Sjekker innlogging...')

  useEffect(() => {
    const resolveAuthRedirect = async () => {
      const url = new URL(window.location.href)
      const code = url.searchParams.get('code')

      if (code) {
        await supabase.auth.exchangeCodeForSession(code)
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setMessage('Venter på bekreftet innlogging...')
        return
      }

      const profile = await getProfileByUserId(user.id)
      router.replace(profile ? '/chat' : '/complete-profile')
    }

    void resolveAuthRedirect()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return
      void getProfileByUserId(session.user.id).then((profile) => {
        router.replace(profile ? '/chat' : '/complete-profile')
      })
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-semibold text-slate-900">Bekrefter konto</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
      </div>
    </main>
  )
}
