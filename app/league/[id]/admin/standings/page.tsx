'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { supabase } from '@/lib/supabase'
import { getProfileByUserId, profileHasUsername } from '@/lib/profiles'

/** Same season year as global admin tabell; league rows store this for DB compatibility. */
const SEASON = 2026

type PositionValue = number | ''

type LeagueTeamRow = {
  team_name: string
  display_order: number
}

type StandingRow = {
  id: string
  team_name: string
  actual_position: number
}

function emptyPositionsMap(teamNames: string[]): Record<string, PositionValue> {
  return Object.fromEntries(teamNames.map((name) => [name, '' as PositionValue]))
}

export default function LeagueAdminStandingsPage() {
  const params = useParams()
  const router = useRouter()
  const rawId = params?.id
  const leagueId = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : ''

  const [leagueName, setLeagueName] = useState('')
  const [teamRows, setTeamRows] = useState<LeagueTeamRow[]>([])
  const [positions, setPositions] = useState<Record<string, PositionValue>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const teamNames = useMemo(() => teamRows.map((r) => r.team_name), [teamRows])
  const n = teamNames.length

  const tableComplete = useMemo(() => {
    if (teamNames.length === 0) return false
    const vals = teamNames.map((t) => positions[t])
    if (vals.some((v) => v === '')) return false
    const nums = vals as number[]
    if (new Set(nums).size !== teamNames.length) return false
    return nums.every((p) => p >= 1 && p <= teamNames.length)
  }, [teamNames, positions])

  const positionOptions = useMemo(
    () => Array.from({ length: n }, (_, i) => i + 1),
    [n]
  )

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      setMessage('')

      if (!leagueId) {
        setError('Ugyldig liga.')
        setLoading(false)
        return
      }

      setTeamRows([])
      setPositions({})
      setLeagueName('')

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

      if (!profile.is_admin) {
        router.replace('/leagues')
        return
      }

      const { data: leagueRow, error: leagueError } = await supabase
        .from('leagues')
        .select('name')
        .eq('id', leagueId)
        .maybeSingle()

      if (leagueError) {
        setError(leagueError.message)
        setLoading(false)
        return
      }

      if (!leagueRow) {
        setError('Fant ikke ligaen.')
        setLoading(false)
        return
      }

      const { data: teamsData, error: teamsError } = await supabase
        .from('league_teams')
        .select('team_name, display_order')
        .eq('league_id', leagueId)
        .order('display_order', { ascending: true })

      if (teamsError) {
        setError(teamsError.message)
        setLoading(false)
        return
      }

      const teams = (teamsData ?? []) as LeagueTeamRow[]
      const names = teams.map((t) => t.team_name)

      const { data: standingsData, error: standingsError } = await supabase
        .from('standings')
        .select('id, team_name, actual_position')
        .eq('league_id', leagueId)

      if (standingsError) {
        setError(standingsError.message)
        setLoading(false)
        return
      }

      const nextPos = emptyPositionsMap(names)
      const nc = names.length
      for (const row of (standingsData ?? []) as StandingRow[]) {
        if (
          names.includes(row.team_name) &&
          row.actual_position >= 1 &&
          row.actual_position <= nc
        ) {
          nextPos[row.team_name] = row.actual_position
        }
      }

      setLeagueName((leagueRow as { name: string | null }).name || 'Liga')
      setTeamRows(teams)
      setPositions(nextPos)
      setLoading(false)
    }

    void load()

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
  }, [leagueId, router])

  const changePosition = (team: string, value: string) => {
    if (teamNames.length === 0) return
    setError('')
    setPositions((prev) => {
      if (value === '') {
        return { ...prev, [team]: '' }
      }
      const nextNum = Number(value)
      const next: Record<string, PositionValue> = { ...prev, [team]: nextNum }
      for (const t of teamNames) {
        if (t !== team && next[t] === nextNum) {
          next[t] = ''
        }
      }
      return next
    })
  }

  const handleSaveStandings = async (e: FormEvent) => {
    e.preventDefault()
    if (!leagueId || teamNames.length === 0) return

    setError('')
    setMessage('')

    const vals = teamNames.map((t) => positions[t])
    if (vals.some((v) => v === '')) {
      setError(`Velg faktisk plassering for alle ${n} lag.`)
      return
    }

    const nums = vals as number[]
    if (new Set(nums).size !== n) {
      setError('Hver plassering kan bare brukes én gang.')
      return
    }

    if (!nums.every((p) => p >= 1 && p <= n)) {
      setError(`Plassering må være mellom 1 og ${n}.`)
      return
    }

    setSaving(true)

    const { data: existing, error: existingError } = await supabase
      .from('standings')
      .select('id, team_name')
      .eq('league_id', leagueId)

    if (existingError) {
      setSaving(false)
      setError(existingError.message)
      return
    }

    const byTeam = new Map((existing ?? []).map((r) => [r.team_name, r.id]))
    const now = new Date().toISOString()

    const updates = []
    const inserts = []

    for (const team of teamNames) {
      const pos = positions[team] as number
      const id = byTeam.get(team)
      if (id) {
        updates.push({
          id,
          league_id: leagueId,
          team_name: team,
          actual_position: pos,
          season: SEASON,
          updated_at: now,
        })
      } else {
        inserts.push({
          league_id: leagueId,
          team_name: team,
          actual_position: pos,
          season: SEASON,
          updated_at: now,
        })
      }
    }

    if (updates.length > 0) {
      const { error: upErr } = await supabase.from('standings').upsert(updates, {
        onConflict: 'id',
      })
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
    if (!leagueId) return
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
        body: JSON.stringify({ leagueId, season: SEASON }),
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
          `Poeng beregnet for ligaen. ${users} bruker(e) oppdatert i leaderboard (${rows} detaljlinjer).`
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
          <p className="text-sm">
            <Link
              href={leagueId ? `/league/${leagueId}` : '/leagues'}
              className="font-medium text-slate-900 underline"
            >
              Tilbake til liga
            </Link>
          </p>

          <h1 className="mt-4 text-xl font-semibold text-slate-900">{leagueName || 'Liga'}</h1>
          <p className="mt-1 text-sm text-slate-600">Admin: faktisk tabell for ligaen</p>

          {loading ? (
            <p className="mt-4 text-sm text-slate-500">Laster tabell...</p>
          ) : error && teamNames.length === 0 ? (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : teamNames.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">Ingen lag i denne ligaen ennå.</p>
          ) : (
            <form onSubmit={handleSaveStandings} className="mt-4 space-y-3">
              {teamNames.map((team) => (
                <div key={team} className="rounded-xl border border-slate-200 p-3">
                  <label className="mb-2 block text-sm font-medium text-slate-800">{team}</label>
                  <select
                    value={positions[team] ?? ''}
                    onChange={(e) => changePosition(team, e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    disabled={saving}
                  >
                    <option value="">Velg plassering</option>
                    {positionOptions.map((pos) => (
                      <option key={pos} value={pos}>
                        {pos}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

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
              disabled={recalculating || loading || !tableComplete || !leagueId}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {recalculating ? 'Beregner...' : 'Beregn poeng'}
            </button>
            <p className="mt-2 text-center text-xs text-slate-500">
              Oppdaterer score_details og leaderboard for denne ligaen (sesong {SEASON}).
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
