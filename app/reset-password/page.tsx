'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const getParam = (key: string) => {
  try {
    const url = new URL(window.location.href)
    const fromQuery = url.searchParams.get(key)
    if (fromQuery) return fromQuery

    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''))
    return hashParams.get(key)
  } catch {
    return null
  }
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const tokenState = useMemo(() => {
    return {
      access_token: getParam('access_token'),
      refresh_token: getParam('refresh_token'),
    }
  }, [])

  const [tokenReady, setTokenReady] = useState(false)

  useEffect(() => {
    const run = async () => {
      if (!tokenState.access_token || !tokenState.refresh_token) {
        setError('Ugyldig eller utløpt lenke. Be om en ny tilbakestillings-e-post.')
        return
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: tokenState.access_token,
        refresh_token: tokenState.refresh_token,
      })

      if (sessionError) {
        setError('Kunne ikke bekrefte tilbakestillingen. Prøv igjen.')
        return
      }

      setTokenReady(true)
    }

    void run()
  }, [tokenState.access_token, tokenState.refresh_token])

  const handleReset = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (newPassword.length < 6) {
      setError('Passordet må være minst 6 tegn.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passordene må være like.')
      return
    }

    if (!tokenReady) {
      setError('Venter på at lenken bekreftes...')
      return
    }

    setLoading(true)

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    setLoading(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setSuccess('Passordet er oppdatert. Du blir sendt til innlogging...')
    setTimeout(() => {
      router.replace('/login')
    }, 1700)
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Velg nytt passord</h1>
        <p className="mt-1 text-sm text-slate-600">
          Skriv inn et nytt passord for kontoen din.
        </p>

        <form onSubmit={handleReset} className="mt-6 space-y-4">
          <div>
            <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-slate-700">
              Nytt passord
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              placeholder="Minst 6 tegn"
              disabled={loading}
            />
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Bekreft nytt passord
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
              disabled={loading}
            />
          </div>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}
          {success ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {success}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Lagrer...' : 'Oppdater passord'}
          </button>
        </form>
      </div>
    </main>
  )
}

