'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AppNav } from '@/components/AppNav'
import { getProfileByUserId, profileHasUsername } from '@/lib/profiles'

export default function ChangePasswordPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      setSuccess('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.replace('/login')
        return
      }

      const profile = await getProfileByUserId(user.id)
      if (!profileHasUsername(profile)) {
        router.replace('/complete-profile')
        return
      }

      setUserId(user.id)
      setLoading(false)
    }

    void load()
  }, [router])

  const handleChange = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!userId) return

    if (newPassword.length < 6) {
      setError('Passordet må være minst 6 tegn.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passordene må være like.')
      return
    }

    setSaving(true)

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setSuccess('Passordet er oppdatert.')
    setTimeout(() => {
      router.replace('/profile')
    }, 1700)
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-md space-y-3">
        <AppNav />
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-2xl font-semibold text-slate-900">Endre passord</h1>
          <p className="mt-1 text-sm text-slate-600">Sett et nytt passord for kontoen din.</p>

          {loading ? (
            <p className="mt-6 text-sm text-slate-500">Laster...</p>
          ) : (
            <form onSubmit={handleChange} className="mt-6 space-y-4">
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
                  disabled={saving}
                  placeholder="Minst 6 tegn"
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
                  disabled={saving}
                  placeholder="Skriv passordet igjen"
                />
              </div>

              {error ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
              ) : null}
              {success ? (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {success} Du blir sendt tilbake til profilen...
                </p>
              ) : null}

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Lagrer...' : 'Oppdater passord'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}

