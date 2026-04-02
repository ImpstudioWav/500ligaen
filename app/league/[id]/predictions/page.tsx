'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AppNav } from '@/components/AppNav'
import { getProfileByUserId } from '@/lib/profiles'
import {
  formatPredictionCountdown,
  resolvePredictionWindow,
} from '@/lib/prediction-window'

type PredictionValue = number | ''

type LeagueTeamRow = {
  team_name: string
  display_order: number
}

type ExistingPrediction = {
  id: string
  team_name: string
  predicted_position: number
}

function emptyPredictionsMap(teamNames: string[]): Record<string, PredictionValue> {
  return Object.fromEntries(teamNames.map((name) => [name, '' as PredictionValue]))
}

export default function LeaguePredictionsPage() {
  const params = useParams()
  const router = useRouter()
  const rawId = params?.id
  const leagueId = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : ''

  const [userId, setUserId] = useState<string | null>(null)
  const [leagueName, setLeagueName] = useState('')
  const [predictionOpenAt, setPredictionOpenAt] = useState<string | null>(null)
  const [predictionCloseAt, setPredictionCloseAt] = useState<string | null>(null)
  const [leagueTeams, setLeagueTeams] = useState<LeagueTeamRow[]>([])
  const [predictions, setPredictions] = useState<Record<string, PredictionValue>>({})
  const [existingPredictions, setExistingPredictions] = useState<ExistingPrediction[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [clockTick, setClockTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setClockTick((n) => n + 1)
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  const teamNames = useMemo(() => leagueTeams.map((row) => row.team_name), [leagueTeams])

  const teamCount = teamNames.length

  const tableComplete = useMemo(() => {
    if (teamNames.length === 0) return false
    const vals = teamNames.map((t) => predictions[t])
    if (vals.some((v) => v === '')) return false
    const nums = vals as number[]
    if (new Set(nums).size !== teamNames.length) return false
    return nums.every((p) => p >= 1 && p <= teamNames.length)
  }, [teamNames, predictions])

  const now = useMemo(() => new Date(), [clockTick])
  const predictionWindow = resolvePredictionWindow(predictionOpenAt, predictionCloseAt, now)
  const predictionsLocked = predictionWindow !== 'open'

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

      const { data: membership, error: memberError } = await supabase
        .from('league_members')
        .select('league_id')
        .eq('user_id', user.id)
        .eq('league_id', leagueId)
        .maybeSingle()

      if (memberError) {
        setError(memberError.message)
        setLoading(false)
        return
      }

      if (!membership) {
        router.replace('/leagues')
        return
      }

      const { data: leagueRow, error: leagueError } = await supabase
        .from('leagues')
        .select('name, prediction_open_at, prediction_close_at')
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

      const { data: teamRows, error: teamsError } = await supabase
        .from('league_teams')
        .select('team_name, display_order')
        .eq('league_id', leagueId)
        .order('display_order', { ascending: true })

      if (teamsError) {
        setError(teamsError.message)
        setLoading(false)
        return
      }

      const teams = (teamRows ?? []) as LeagueTeamRow[]
      const names = teams.map((t) => t.team_name)

      const { data: predRows, error: predError } = await supabase
        .from('predictions')
        .select('id, team_name, predicted_position')
        .eq('league_id', leagueId)
        .eq('user_id', user.id)

      if (predError) {
        setError(predError.message)
        setLoading(false)
        return
      }

      const nextMap = emptyPredictionsMap(names)
      const n = names.length
      for (const row of (predRows ?? []) as ExistingPrediction[]) {
        if (
          names.includes(row.team_name) &&
          row.predicted_position >= 1 &&
          row.predicted_position <= n
        ) {
          nextMap[row.team_name] = row.predicted_position
        }
      }

      const lr = leagueRow as {
        name: string | null
        prediction_open_at: string | null
        prediction_close_at: string | null
      }
      setLeagueName(lr.name || 'Liga')
      setPredictionOpenAt(lr.prediction_open_at ?? null)
      setPredictionCloseAt(lr.prediction_close_at ?? null)
      setUserId(user.id)
      setLeagueTeams(teams)
      setExistingPredictions((predRows ?? []) as ExistingPrediction[])
      setPredictions(nextMap)
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

  const handlePositionChange = (team: string, value: string) => {
    if (teamNames.length === 0 || predictionsLocked) return

    if (value === '') {
      setError('')
      setPredictions((prev) => ({ ...prev, [team]: '' }))
      return
    }

    const nextNum = Number(value)
    setError('')
    setPredictions((prev) => {
      const next: Record<string, PredictionValue> = { ...prev, [team]: nextNum }
      for (const t of teamNames) {
        if (t !== team && next[t] === nextNum) {
          next[t] = ''
        }
      }
      return next
    })
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!userId || !leagueId || teamNames.length === 0 || predictionsLocked) return

    setError('')
    setMessage('')

    const n = teamNames.length
    if (teamNames.some((t) => predictions[t] === '')) {
      setError(`Velg plassering 1–${n} for alle lag.`)
      return
    }

    const numericValues = teamNames.map((t) => predictions[t] as number)
    if (new Set(numericValues).size !== n) {
      setError('Hver plassering kan bare brukes én gang.')
      return
    }

    if (!numericValues.every((p) => p >= 1 && p <= n)) {
      setError(`Plassering må være mellom 1 og ${n}.`)
      return
    }

    setSaving(true)

    const existingByTeam = new Map(existingPredictions.map((row) => [row.team_name, row]))
    const updates = teamNames
      .filter((team) => existingByTeam.has(team))
      .map((team) => ({
        id: existingByTeam.get(team)!.id,
        user_id: userId,
        league_id: leagueId,
        team_name: team,
        predicted_position: predictions[team] as number,
      }))

    const inserts = teamNames
      .filter((team) => !existingByTeam.has(team))
      .map((team) => ({
        user_id: userId,
        league_id: leagueId,
        team_name: team,
        predicted_position: predictions[team] as number,
      }))

    if (updates.length > 0) {
      const { error: updateError } = await supabase.from('predictions').upsert(updates, {
        onConflict: 'id',
      })
      if (updateError) {
        setSaving(false)
        setError(updateError.message)
        return
      }
    }

    if (inserts.length > 0) {
      const { error: insertError } = await supabase.from('predictions').insert(inserts)
      if (insertError) {
        setSaving(false)
        setError(insertError.message)
        return
      }
    }

    const { data: refreshed, error: refreshError } = await supabase
      .from('predictions')
      .select('id, team_name, predicted_position')
      .eq('league_id', leagueId)
      .eq('user_id', userId)

    setSaving(false)

    if (refreshError) {
      setError(refreshError.message)
      return
    }

    setExistingPredictions((refreshed ?? []) as ExistingPrediction[])
    setMessage('Prediksjoner lagret.')
  }

  const positionOptions = useMemo(
    () => Array.from({ length: teamCount }, (_, i) => i + 1),
    [teamCount]
  )

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

          <h1 className="mt-4 text-xl font-semibold text-slate-900">
            {leagueName || 'Liga'}
          </h1>
          <p className="mt-1 text-sm text-slate-600">Velg tabellplassering for hvert lag.</p>

          {loading ? (
            <p className="mt-4 text-sm text-slate-500">Laster...</p>
          ) : error && teamNames.length === 0 ? (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : teamNames.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">Ingen lag i denne ligaen ennå.</p>
          ) : (
            <form onSubmit={handleSave} className="mt-4 space-y-3">
              {predictionWindow === 'before_open' && predictionOpenAt ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <span className="font-medium">Prediksjoner åpner om:</span>{' '}
                  <span className="font-mono tabular-nums font-semibold">
                    {formatPredictionCountdown(predictionOpenAt, now)}
                  </span>
                </p>
              ) : null}
              {predictionWindow === 'open' && predictionCloseAt ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  <span className="font-medium">Prediksjoner stenger om:</span>{' '}
                  <span className="font-mono tabular-nums font-semibold">
                    {formatPredictionCountdown(predictionCloseAt, now)}
                  </span>
                </p>
              ) : null}
              {predictionWindow === 'closed' ? (
                <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800">
                  Prediksjoner er stengt
                </p>
              ) : null}
              {teamNames.map((team) => (
                <div key={team} className="rounded-xl border border-slate-200 p-3">
                  <label className="mb-2 block text-sm font-medium text-slate-800">{team}</label>
                  <select
                    value={predictions[team] ?? ''}
                    onChange={(e) => handlePositionChange(team, e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    disabled={saving || predictionsLocked}
                  >
                    <option value="">Velg plassering</option>
                    {positionOptions.map((position) => (
                      <option key={position} value={position}>
                        {position}
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
                disabled={saving || !tableComplete || predictionsLocked}
                className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Lagrer...' : 'Lagre prediksjoner'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}
