'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ensureProfileForUser } from '@/lib/profiles'

export default function ProfilePage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const loadProfile = async () => {
      setError('')
      setMessage('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.replace('/login')
        return
      }

      setUserId(user.id)

      try {
        const existingOrGeneratedUsername = await ensureProfileForUser(user.id)
        setUsername(existingOrGeneratedUsername)
      } catch (profileError) {
        const msg =
          profileError instanceof Error ? profileError.message : 'Kunne ikke laste profil.'
        setError(msg)
      } finally {
        setLoading(false)
      }
    }

    void loadProfile()

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

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()

    if (!userId) return
    const trimmed = username.trim()
    if (!trimmed) {
      setError('Brukernavn kan ikke være tomt.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ username: trimmed })
      .eq('id', userId)

    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setUsername(trimmed)
    setMessage('Brukernavn lagret.')
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Profil</h1>
        <p className="mt-1 text-sm text-slate-600">Se og oppdater brukernavnet ditt.</p>

        {loading ? (
          <p className="mt-6 text-sm text-slate-500">Laster profil...</p>
        ) : (
          <form onSubmit={handleSave} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="username"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Brukernavn
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={24}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                placeholder="Skriv brukernavn"
                disabled={saving}
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
              disabled={saving}
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Lagrer...' : 'Lagre brukernavn'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
