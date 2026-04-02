'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    // If already logged in, keep UX predictable.
    const checkUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        router.replace('/chat')
      }
    }
    void checkUser()
  }, [router])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    const normalizedEmail = email.trim().toLowerCase()
    setError('')
    setMessage('')

    if (!normalizedEmail) {
      setError('Skriv inn e-post.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: 'http://localhost:3000/reset-password',
    })
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setMessage('Vi har sendt deg en e-post med instruksjoner for å tilbakestille passordet.')
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Glemt passord</h1>
        <p className="mt-1 text-sm text-slate-600">
          Skriv inn e-posten din, så sender vi deg en lenke for å velge nytt passord.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
              disabled={loading}
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
            disabled={loading}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Sender...' : 'Send lenke'}
          </button>

          <p className="text-center text-sm text-slate-600">
            Husk passordet?{' '}
            <Link href="/login" className="font-medium text-slate-900 underline">
              Logg inn
            </Link>
          </p>
        </form>
      </div>
    </main>
  )
}

