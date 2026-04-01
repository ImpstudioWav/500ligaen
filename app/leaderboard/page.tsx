'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type LeaderboardRow = {
  id: string
  user_id: string
  points: number
  updated_at: string
}

export default function LeaderboardPage() {
  const router = useRouter()
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadLeaderboard = async () => {
      setError('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.replace('/login')
        return
      }

      const { data, error: leaderboardError } = await supabase
        .from('leaderboard')
        .select('id, user_id, points, updated_at')
        .order('points', { ascending: false })
        .order('updated_at', { ascending: true })

      if (leaderboardError) {
        setError(leaderboardError.message)
      } else {
        setRows(data ?? [])
      }

      setLoading(false)
    }

    void loadLeaderboard()
  }, [router])

  const rankedRows = useMemo(
    () => rows.map((row, index) => ({ rank: index + 1, ...row })),
    [rows]
  )

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-md rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="border-b border-slate-200 px-4 py-3">
          <h1 className="text-lg font-semibold text-slate-900">Leaderboard</h1>
          <p className="text-xs text-slate-500">Toppliste basert på poeng</p>
        </div>

        <section className="p-4">
          {loading ? (
            <p className="text-sm text-slate-500">Laster leaderboard...</p>
          ) : error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : rankedRows.length === 0 ? (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
              Ingen data ennå. Poenglisten dukker opp når første resultater er lagt inn.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-3 py-2 font-medium">Rank</th>
                    <th className="px-3 py-2 font-medium">User ID</th>
                    <th className="px-3 py-2 font-medium">Poeng</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedRows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-200">
                      <td className="px-3 py-2 text-slate-900">{row.rank}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{row.user_id}</td>
                      <td className="px-3 py-2 font-medium text-slate-900">{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
