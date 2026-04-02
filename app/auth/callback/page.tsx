'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getProfileByUserId } from '@/lib/profiles'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [message, setMessage] = useState('Bekrefter konto...')

  useEffect(() => {
    const failureMessage = 'Kunne ikke bekrefte kontoen. Prøv å logge inn igjen.'
    const expiredLinkMessage = 'Bekreftelseslenken er ugyldig eller utløpt. Be om en ny e-post.'
    let isActive = true

    const resolveAuthRedirect = async () => {
      try {
        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')
        const queryErrorCode = url.searchParams.get('error_code')
        const queryDescription = url.searchParams.get('error_description')?.toLowerCase() ?? ''
        const hashParams = new URLSearchParams(window.location.hash.replace('#', ''))
        const hashErrorCode = hashParams.get('error_code')
        const hashDescription = hashParams.get('error_description')?.toLowerCase() ?? ''

        const hasExpiredOrInvalidLink =
          queryErrorCode === 'otp_expired' ||
          hashErrorCode === 'otp_expired' ||
          queryDescription.includes('invalid') ||
          queryDescription.includes('expired') ||
          hashDescription.includes('invalid') ||
          hashDescription.includes('expired')

        if (hasExpiredOrInvalidLink) {
          if (isActive) {
            setMessage(expiredLinkMessage)
          }
          return
        }

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            throw exchangeError
          }
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError) {
          throw userError
        }

        if (!user) {
          if (isActive) {
            setMessage(failureMessage)
          }
          return
        }

        const profile = await getProfileByUserId(user.id)
        isActive = false
        router.replace(profile ? '/leagues' : '/complete-profile')
      } catch {
        if (isActive) {
          setMessage(failureMessage)
        }
      }
    }

    void resolveAuthRedirect()

    const timeout = setTimeout(() => {
      if (isActive) {
        setMessage(failureMessage)
      }
    }, 15000)

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return
      void getProfileByUserId(session.user.id)
        .then((profile) => {
          isActive = false
          router.replace(profile ? '/leagues' : '/complete-profile')
        })
        .catch(() => {
          if (isActive) {
            setMessage(failureMessage)
          }
        })
    })

    return () => {
      isActive = false
      clearTimeout(timeout)
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
