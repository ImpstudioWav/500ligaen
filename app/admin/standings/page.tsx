'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { supabase } from '@/lib/supabase'

const SEASON = 2026

const TEAMS = [
  'Bodø/Glimt',
  'Brann',
  'Rosenborg',
  'Viking',
  'Molde',
  'Tromsø',
  'Sarpsborg 08',
  'Fredrikstad',
  'HamKam',
  'KFUM',
  'Vålerenga',
  'Sandefjord',
  'Strømsgodset',
  'Kristiansund',
  'Bryne',
  'Haugesund',
] as const

type TeamName = (typeof TEAMS)[number]
type PositionValue = number | ''
type PositionsMap = Record<TeamName, PositionValue>

const emptyPositions = (): PositionsMap =>
  Object.fromEntries(TEAMS.map((t) => [t, ''])) as PositionsMap

type StandingRow = {
  id: string
  team_name: string
  actual_position: number
}

export default function AdminStandingsPage() {
  const router = useRouter()
  const [positions, setPositions] = useState<PositionsMap>(emptyPositions)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const load = async () => {
      setError('')
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.replace('/login')
        return
      }

      const { data, error: fetchError } = await supabase
        .from('standings')
        .select('id, team_name, actual_position')
        .eq('season', SEASON)

      if (fetchError) {
        setError(fetchError.message)
        setLoading(false)
        return
      }

      const next = emptyPositions()
      for (const row of (data ?? []) as StandingRow[]) {
        if (
          TEAMS.includes(row.team_name as TeamName) &&
          row.actual_position >= 1 &&
          row.actual_position <= 16
        ) {
          next[row.team_name as TeamName] = row.actual_position
        }
      }
      setPositions(next)
      setLoading(false)
    }

    void load()
  }, [router])

  const tableComplete = useMemo(() => {
    const vals = TEAMS.map((t) => positions[t])
    if (vals.some((v) => v === '')) return false
    const nums = vals as number[]
    return new Set(nums).size === 16
  }, [positions])

  const changePosition = (team: TeamName, value: string) => {
    setError('')
    setPositions((prev) => {
      if (value === '') {
        return { ...prev, [team]: '' }
      }
      const nextNum = Number(value)
      const next: PositionsMap = { ...prev, [team]: nextNum }
      for (const t of TEAMS) {
        if (t !== team && next[t] === nextNum) {
          next[t] = ''
        }
      }
      return next
    })
  }

  const handleSaveStandings = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')

    const vals = TEAMS.map((t) => positions[t])
    if (vals.some((v) => v === '')) {
      setError('Velg faktisk plassering for alle 16 lag.')
      return
    }
    const nums = vals as number[]
    if (new Set(nums).size !== 16) {
      setError('Hver plassering kan bare brukes én gang.')
      return
    }

    setSaving(true)

    const { data: existing, error: existingError } = await supabase
      .from('standings')
      .select('id, team_name')
      .eq('season', SEASON)

    if (existingError) {
      setSaving(false)
      setError(existingError.message)
      return
    }

    const byTeam = new Map((existing ?? []).map((r) => [r.team_name, r.id]))
    const now = new Date().toISOString()
    const updates: Array<{
      id: string
      team_name: string
      actual_position: number
      season: number
      updated_at: string
    }> = []
    const inserts: Array<{
      team_name: string
      actual_position: number
      season: number
      updated_at: string
    }> = []

    for (const team of TEAMS) {
      const pos = positions[team] as number
      const id = byTeam.get(team)
      if (id) {
        updates.push({
          id,
          team_name: team,
          actual_position: pos,
          season: SEASON,
          updated_at: now,
        })
      } else {
        inserts.push({
          team_name: team,
          actual_position: pos,
          season: SEASON,
          updated_at: now,
        })
      }
    }

    if (updates.length > 0) {
      const { error: upErr } = await supabase
        .from('standings')
        .upsert(updates, { onConflict: 'id' })
      if (upErr) {
        setSaving(false)
        setError(upErr.message)
        return
      }
    }

    if (inserts.length > 0) {
      const { error: inErr } = await supabase.from('standings').insert(inserts)
      if (inErr) {
        setSaving(false)
        setError(inErr.message)
        return
      }
    }

    setSaving(false)
    setMessage('Tabell lagret.')
  }

  const handleRecalculate = async () => {
    setError('')
    setMessage('')
    setRecalculating(true)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    try {
      const res = await fetch('/api/recalculate-scores', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({ season: SEASON }),
      })
      const json = (await res.json()) as {
        error?: string
        usersUpdated?: number
        scoreDetailRows?: number
        teamsInStandings?: number
      }

      if (!res.ok) {
        setError(json.error ?? 'Kunne ikke beregne poeng.')
      } else {
        const users = json.usersUpdated ?? 0
        const rows = json.scoreDetailRows ?? 0
        setMessage(
          `Poeng beregnet. ${users} bruker(e) oppdatert i leaderboard (${rows} detaljlinjer).`
        )
      }
    } catch {
      setError('Nettverksfeil ved beregning.')
    } finally {
      setRecalculating(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-md space-y-3">
        <AppNav />
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-xl font-semibold text-slate-900">Admin: tabell</h1>
          <p className="mt-1 text-sm text-slate-600">
            Eliteserien {SEASON} — faktisk plassering per lag
          </p>

          {loading ? (
            <p className="mt-4 text-sm text-slate-500">Laster tabell...</p>
          ) : (
            <form onSubmit={handleSaveStandings} className="mt-4 space-y-3">
              {TEAMS.map((team) => (
                <div key={team} className="rounded-xl border border-slate-200 p-3">
                  <label className="mb-2 block text-sm font-medium text-slate-800">
                    {team}
                  </label>
                  <select
                    value={positions[team]}
                    onChange={(e) => changePosition(team, e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    disabled={saving}
                  >
                    <option value="">Velg plassering</option>
                    {Array.from({ length: 16 }, (_, i) => i + 1).map((pos) => (
                      <option key={pos} value={pos}>
                        {pos}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              {error ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              ) : null}
              {message ? (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {message}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={saving || !tableComplete}
                className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Lagrer...' : 'Lagre tabell'}
              </button>
            </form>
          )}

          <div className="mt-4 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={handleRecalculate}
              disabled={recalculating || loading || !tableComplete}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {recalculating ? 'Beregner...' : 'Beregn poeng'}
            </button>
            <p className="mt-2 text-center text-xs text-slate-500">
              Oppdaterer score_details og leaderboard for sesong {SEASON}.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
