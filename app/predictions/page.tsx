'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getProfileByUserId } from '@/lib/profiles'

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
type PredictionValue = number | ''
type PredictionsMap = Record<TeamName, PredictionValue>

type ExistingPrediction = {
  id: string
  team_name: TeamName
  predicted_position: number
}

const emptyPredictions = () =>
  Object.fromEntries(TEAMS.map((team) => [team, ''])) as PredictionsMap

export default function PredictionsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [predictions, setPredictions] = useState<PredictionsMap>(emptyPredictions)
  const [existingPredictions, setExistingPredictions] = useState<ExistingPrediction[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const loadPredictions = async () => {
      setError('')
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

      setUserId(user.id)

      const { data, error: predictionsError } = await supabase
        .from('predictions')
        .select('id, team_name, predicted_position')
        .eq('user_id', user.id)

      if (predictionsError) {
        setError(predictionsError.message)
        setLoading(false)
        return
      }

      const nextPredictions = emptyPredictions()
      for (const row of (data ?? []) as ExistingPrediction[]) {
        if (TEAMS.includes(row.team_name) && row.predicted_position >= 1 && row.predicted_position <= 16) {
          nextPredictions[row.team_name] = row.predicted_position
        }
      }

      setExistingPredictions((data ?? []) as ExistingPrediction[])
      setPredictions(nextPredictions)
      setLoading(false)
    }

    void loadPredictions()
  }, [router])

  const selectedPositions = useMemo(
    () => Object.values(predictions).filter((value): value is number => typeof value === 'number'),
    [predictions]
  )

  const handlePositionChange = (team: TeamName, value: string) => {
    const nextValue: PredictionValue = value === '' ? '' : Number(value)
    if (typeof nextValue === 'number') {
      const duplicate = TEAMS.some(
        (otherTeam) => otherTeam !== team && predictions[otherTeam] === nextValue
      )
      if (duplicate) {
        setError('Hver plassering kan bare brukes en gang.')
        return
      }
    }

    setError('')
    setPredictions((prev) => ({
      ...prev,
      [team]: nextValue,
    }))
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!userId) return

    setError('')
    setMessage('')

    const values = TEAMS.map((team) => predictions[team])
    if (values.some((value) => value === '')) {
      setError('Velg plassering 1-16 for alle lag.')
      return
    }

    const numericValues = values as number[]
    if (new Set(numericValues).size !== 16) {
      setError('Hver plassering kan bare brukes en gang.')
      return
    }

    setSaving(true)

    const existingByTeam = new Map(existingPredictions.map((row) => [row.team_name, row]))
    const updates = TEAMS.filter((team) => existingByTeam.has(team)).map((team) => ({
      id: existingByTeam.get(team)!.id,
      user_id: userId,
      team_name: team,
      predicted_position: predictions[team] as number,
    }))
    const inserts = TEAMS.filter((team) => !existingByTeam.has(team)).map((team) => ({
      user_id: userId,
      team_name: team,
      predicted_position: predictions[team] as number,
    }))

    if (updates.length > 0) {
      const { error: updateError } = await Promise.resolve(
        supabase.from('predictions').upsert(updates, { onConflict: 'id' })
      )
      if (updateError) {
        setSaving(false)
        setError(updateError.message)
        return
      }
    }

    if (inserts.length > 0) {
      const { data: insertedRows, error: insertError } = await supabase
        .from('predictions')
        .insert(inserts)
        .select('id, team_name, predicted_position')
      if (insertError) {
        setSaving(false)
        setError(insertError.message)
        return
      }

      setExistingPredictions((prev) => [...prev, ...((insertedRows ?? []) as ExistingPrediction[])])
    }

    setSaving(false)
    setMessage('Prediksjoner lagret.')
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-semibold text-slate-900">Prediksjoner</h1>
        <p className="mt-1 text-sm text-slate-600">Velg tabellplassering for alle 16 lag.</p>

        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Laster prediksjoner...</p>
        ) : (
          <form onSubmit={handleSave} className="mt-4 space-y-3">
            {TEAMS.map((team) => (
              <div key={team} className="rounded-xl border border-slate-200 p-3">
                <label className="mb-2 block text-sm font-medium text-slate-800">{team}</label>
                <select
                  value={predictions[team]}
                  onChange={(e) => handlePositionChange(team, e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  disabled={saving}
                >
                  <option value="">Velg plassering</option>
                  {Array.from({ length: 16 }, (_, i) => i + 1).map((position) => {
                    const usedByOtherTeam = TEAMS.some(
                      (otherTeam) =>
                        otherTeam !== team && predictions[otherTeam] === position
                    )
                    return (
                      <option key={position} value={position} disabled={usedByOtherTeam}>
                        {position}
                      </option>
                    )
                  })}
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
              disabled={saving || selectedPositions.length !== 16}
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Lagrer...' : 'Lagre prediksjoner'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
