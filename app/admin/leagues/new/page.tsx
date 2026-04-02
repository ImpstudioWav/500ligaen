'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { supabase } from '@/lib/supabase'
import { getProfileByUserId } from '@/lib/profiles'

type StatusOption = 'draft' | 'open'

function slugFromName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'league'
}

function parseTeamLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function toIsoOrNull(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export default function AdminNewLeaguePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [status, setStatus] = useState<StatusOption>('draft')
  const [predictionOpen, setPredictionOpen] = useState('')
  const [predictionClose, setPredictionClose] = useState('')
  const [teamsText, setTeamsText] = useState('')

  const slugPreview = useMemo(() => slugFromName(name), [name])

  useEffect(() => {
    const gate = async () => {
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

      if (!profile.is_admin) {
        router.replace('/leagues')
        return
      }

      setLoading(false)
    }

    void gate()

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    const trimmedName = name.trim()
    const trimmedJoin = joinCode.trim()

    if (!trimmedName) {
      setError('Liganavn er påkrevd.')
      return
    }
    if (!trimmedJoin) {
      setError('Join-kode er påkrevd.')
      return
    }

    const slug = slugFromName(trimmedName)
    const teams = parseTeamLines(teamsText)
    if (teams.length < 2) {
      setError('Minst to lag kreves (én per linje i tekstfeltet).')
      return
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      router.replace('/login')
      return
    }

    const { data: existingCode } = await supabase
      .from('leagues')
      .select('id')
      .eq('join_code', trimmedJoin)
      .maybeSingle()

    if (existingCode) {
      setError('Denne join-koden er allerede i bruk.')
      return
    }

    const { data: existingSlug } = await supabase
      .from('leagues')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()

    if (existingSlug) {
      setError('Slug er allerede i bruk. Endre liganavnet litt.')
      return
    }

    const prediction_open_at = toIsoOrNull(predictionOpen)
    const prediction_close_at = toIsoOrNull(predictionClose)

    setSaving(true)

    const { data: leagueRow, error: leagueError } = await supabase
      .from('leagues')
      .insert({
        name: trimmedName,
        slug,
        join_code: trimmedJoin,
        status,
        prediction_open_at,
        prediction_close_at,
      })
      .select('id')
      .single()

    if (leagueError || !leagueRow) {
      setSaving(false)
      const msg = leagueError?.message ?? 'Kunne ikke opprette liga.'
      if (msg.toLowerCase().includes('duplicate') || leagueError?.code === '23505') {
        setError('Join-kode eller slug er allerede i bruk.')
      } else {
        setError(msg)
      }
      return
    }

    const leagueId = leagueRow.id as string

    const teamRows = teams.map((team_name, index) => ({
      league_id: leagueId,
      team_name,
      display_order: index + 1,
    }))

    const { error: teamsError } = await supabase.from('league_teams').insert(teamRows)

    if (teamsError) {
      await supabase.from('leagues').delete().eq('id', leagueId)
      setSaving(false)
      setError(teamsError.message)
      return
    }

    const { error: memberError } = await supabase.from('league_members').insert({
      league_id: leagueId,
      user_id: user.id,
    })

    if (memberError) {
      await supabase.from('league_teams').delete().eq('league_id', leagueId)
      await supabase.from('leagues').delete().eq('id', leagueId)
      setSaving(false)
      setError(memberError.message)
      return
    }

    setSaving(false)
    router.replace(`/league/${leagueId}`)
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-md space-y-3">
        <AppNav />

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <p className="text-sm">
            <Link href="/leagues" className="font-medium text-slate-900 underline">
              Tilbake til ligaer
            </Link>
          </p>

          <h1 className="mt-4 text-xl font-semibold text-slate-900">Ny liga</h1>
          <p className="mt-1 text-sm text-slate-600">
            Opprett liga, lag og join-kode. Du legges automatisk inn som medlem.
          </p>

          {loading ? (
            <p className="mt-6 text-sm text-slate-500">Laster...</p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="league-name" className="mb-1 block text-sm font-medium text-slate-700">
                  Liganavn <span className="text-red-600">*</span>
                </label>
                <input
                  id="league-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  disabled={saving}
                  placeholder="F.eks. Kontoret vår"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Slug: <span className="font-medium text-slate-700">{slugPreview}</span>
                </p>
              </div>

              <div>
                <label htmlFor="join-code" className="mb-1 block text-sm font-medium text-slate-700">
                  Join-kode <span className="text-red-600">*</span>
                </label>
                <input
                  id="join-code"
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  required
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  disabled={saving}
                  placeholder="Unik kode medlemmer bruker"
                />
              </div>

              <div>
                <label htmlFor="status" className="mb-1 block text-sm font-medium text-slate-700">
                  Status
                </label>
                <select
                  id="status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as StatusOption)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  disabled={saving}
                >
                  <option value="draft">Draft</option>
                  <option value="open">Open</option>
                </select>
              </div>

              <div>
                <label htmlFor="pred-open" className="mb-1 block text-sm font-medium text-slate-700">
                  Prediksjoner åpner
                </label>
                <input
                  id="pred-open"
                  type="datetime-local"
                  value={predictionOpen}
                  onChange={(e) => setPredictionOpen(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  disabled={saving}
                />
              </div>

              <div>
                <label htmlFor="pred-close" className="mb-1 block text-sm font-medium text-slate-700">
                  Prediksjoner stenger
                </label>
                <input
                  id="pred-close"
                  type="datetime-local"
                  value={predictionClose}
                  onChange={(e) => setPredictionClose(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  disabled={saving}
                />
              </div>

              <div>
                <label htmlFor="teams" className="mb-1 block text-sm font-medium text-slate-700">
                  Lag (minst 2) <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="teams"
                  value={teamsText}
                  onChange={(e) => setTeamsText(e.target.value)}
                  rows={8}
                  required
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  disabled={saving}
                  placeholder={"Ett lag per linje\nBodø/Glimt\nBrann\n..."}
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
                {saving ? 'Oppretter...' : 'Opprett liga'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}
