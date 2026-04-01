'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getProfileByUserId } from '@/lib/profiles'

const duplicateEmailMessage = 'E-post er allerede i bruk'

const isDuplicateEmailError = (message: string) => {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('already registered') ||
    normalized.includes('already exists') ||
    normalized.includes('user already registered')
  )
}

export default function SignUpPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const checkUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const profile = await getProfileByUserId(user.id)
        router.replace(profile ? '/chat' : '/complete-profile')
      }
    }

    void checkUser()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void getProfileByUserId(session.user.id).then((profile) => {
          router.replace(profile ? '/chat' : '/complete-profile')
        })
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  const handleSignUp = async (e: FormEvent) => {
    e.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()

    if (password !== confirmPassword) {
      setError('Passordene må være like.')
      return
    }

    setLoading(true)
    setError('')

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: 'http://localhost:3000/auth/callback',
      },
    })

    if (signUpError) {
      setLoading(false)
      setError(isDuplicateEmailError(signUpError.message) ? duplicateEmailMessage : signUpError.message)
      return
    }

    const user = signUpData.user
    if (!user) {
      setLoading(false)
      setError('E-post er allerede i bruk. Prøv å logge inn.')
      return
    }

    const identities = (user as { identities?: Array<unknown> }).identities
    if (Array.isArray(identities) && identities.length === 0) {
      setLoading(false)
      setError('E-post er allerede i bruk. Prøv å logge inn.')
      return
    }

    const session = signUpData.session ?? (await supabase.auth.getSession()).data.session
    if (!session?.user) {
      setLoading(false)
      router.replace('/check-email')
      return
    }
    setLoading(false)
    router.replace('/complete-profile')
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Opprett konto</h1>
        <p className="mt-1 text-sm text-slate-600">Registrer deg med e-post og passord.</p>

        <form onSubmit={handleSignUp} className="mt-6 space-y-4">
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
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
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

          <div>
            <label
              htmlFor="confirm-password"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Bekreft passord
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              placeholder="Skriv passordet igjen"
            />
          </div>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Jobber...' : 'Opprett konto'}
          </button>

          <p className="text-center text-sm text-slate-600">
            Har du allerede konto?{' '}
            <Link href="/login" className="font-medium text-slate-900 underline">
              Logg inn
            </Link>
          </p>
        </form>
      </div>
    </main>
  )
}
