'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getProfileByUserId } from '@/lib/profiles'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const checkUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const profile = await getProfileByUserId(user.id)
        router.replace(profile ? '/leagues' : '/complete-profile')
      }
    }

    void checkUser()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void getProfileByUserId(session.user.id).then((profile) => {
          router.replace(profile ? '/leagues' : '/complete-profile')
        })
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (loginError) {
      setError(loginError.message)
      return
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const profile = await getProfileByUserId(user.id)
      router.replace(profile ? '/leagues' : '/complete-profile')
      return
    }
    setError('Kunne ikke hente brukerprofil. Prøv igjen.')
  }

  return (
    <main className="flex min-h-screen min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 py-10 sm:py-12">
      <div className="relative mx-auto w-full max-w-md overflow-visible">
        <div className="pointer-events-none absolute left-1/2 top-0 z-0 w-[min(100%,18rem)] max-w-full -translate-x-1/2 -translate-y-[62%] sm:w-[min(100%,21rem)]">
          <img
            src="/500ligaen-logo.png"
            alt="500ligaen"
            className="mx-auto block h-auto w-full object-contain drop-shadow-sm"
            width={480}
            height={160}
            decoding="async"
          />
        </div>

        <div className="relative z-10 rounded-2xl bg-white px-5 pb-5 pt-5 shadow-sm ring-1 ring-slate-200 sm:px-6 sm:pb-6 sm:pt-6">
          <div className="relative z-10 mx-auto w-full max-w-sm pt-8 sm:pt-10">
            <h1 className="text-center text-2xl font-semibold text-slate-900">Logg inn</h1>
            <p className="mt-1 text-center text-sm text-slate-600">Logg inn med e-post og passord.</p>

            <form onSubmit={handleLogin} className="mt-4 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
              E-post
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              placeholder="navn@epost.no"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Passord
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              placeholder="Minst 6 tegn"
            />
          </div>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}

          <div className="space-y-2 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Jobber...' : 'Logg inn'}
            </button>

            <p className="text-center text-sm text-slate-600">
              <Link href="/forgot-password" className="font-medium text-slate-900 underline">
                Glemt passord?
              </Link>
            </p>
          </div>

          <p className="text-center text-sm text-slate-600">
            Har du ikke konto?{' '}
            <Link href="/signup" className="font-medium text-slate-900 underline">
              Opprett konto
            </Link>
          </p>
            </form>
          </div>
        </div>
      </div>
    </main>
  )
}
