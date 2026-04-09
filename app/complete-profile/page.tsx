'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  createProfileWithUsername,
  getProfileByUserId,
  isReservedUsername,
  profileHasUsername,
  RESERVED_USERNAME_ERROR,
} from '@/lib/profiles'

export default function CompleteProfilePage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadUser = async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError || !user) {
          router.replace('/login')
          return
        }

        const profile = await getProfileByUserId(user.id)
        if (profileHasUsername(profile)) {
          router.replace('/leagues')
          return
        }

        setUserId(user.id)
      } catch (loadErr) {
        console.error('complete-profile load failed', loadErr)
        setError('Kunne ikke laste profil. Prøv å oppdatere siden.')
      } finally {
        setLoading(false)
      }
    }

    void loadUser()
  }, [router])

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()

    if (!userId) {
      setError('Bruker ikke lastet. Vent et øyeblikk og prøv igjen.')
      return
    }
    const trimmedUsername = username.trim()
    if (trimmedUsername.length < 3) {
      setError('Brukernavn må være minst 3 tegn.')
      return
    }
    if (isReservedUsername(trimmedUsername)) {
      setError(RESERVED_USERNAME_ERROR)
      return
    }

    setSaving(true)
    setError('')

    const result = await createProfileWithUsername(userId, trimmedUsername)
    if (result.error === null) {
      router.replace('/leagues')
    } else if (result.error === 'username_taken') {
      setError('Brukernavnet er allerede tatt')
    } else {
      setError('Kunne ikke lagre brukernavn')
    }
    setSaving(false)
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Fullfør profil</h1>
        <p className="mt-1 text-sm text-slate-600">
          Du må velge brukernavn før du kan bruke appen.
        </p>

        {loading ? (
          <p className="mt-6 text-sm text-slate-500">Laster...</p>
        ) : (
          <form onSubmit={handleSave} className="mt-6 space-y-4">
            <div>
              <label htmlFor="username" className="mb-1 block text-sm font-medium text-slate-700">
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
                placeholder="f.eks. mikk123"
                disabled={saving}
              />
            </div>

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Lagrer...' : 'Lagre og fortsett'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
