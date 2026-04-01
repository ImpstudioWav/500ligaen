import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { computeTeamScore } from '@/lib/scoring'

type StandingRow = {
  team_name: string
  actual_position: number
  season: number
}

type PredictionRow = {
  user_id: string
  team_name: string
  predicted_position: number
}

function parseSeason(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }
  return 2026
}

export async function POST(request: Request) {
  const secret = process.env.RECALCULATE_SCORES_SECRET
  if (secret) {
    const header = request.headers.get('x-recalc-secret')
    if (header !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let season: number
  try {
    const body = await request.json().catch(() => ({}))
    season = parseSeason(body.season)
  } catch {
    season = 2026
  }

  try {
    const supabase = getSupabaseAdmin()

    const { data: standings, error: standingsError } = await supabase
      .from('standings')
      .select('team_name, actual_position, season')
      .eq('season', season)

    if (standingsError) {
      return NextResponse.json({ error: standingsError.message }, { status: 500 })
    }

    if (!standings?.length) {
      return NextResponse.json(
        { error: `Ingen tabellrad funnet for season=${season}` },
        { status: 400 }
      )
    }

    const { data: predictions, error: predictionsError } = await supabase
      .from('predictions')
      .select('user_id, team_name, predicted_position')

    if (predictionsError) {
      return NextResponse.json({ error: predictionsError.message }, { status: 500 })
    }

    const standingsByTeam = new Map<string, number>()
    for (const row of standings as StandingRow[]) {
      standingsByTeam.set(row.team_name, row.actual_position)
    }

    const predictionsByUser = new Map<string, PredictionRow[]>()
    for (const row of (predictions ?? []) as PredictionRow[]) {
      const list = predictionsByUser.get(row.user_id) ?? []
      list.push(row)
      predictionsByUser.set(row.user_id, list)
    }

    const scoreRows: Array<{
      user_id: string
      team_name: string
      predicted_position: number
      actual_position: number
      gp: number
      bk: number
      bl: number
      b3: number
      total_points: number
      season: number
    }> = []

    for (const [userId, userPredictions] of predictionsByUser) {
      for (const pred of userPredictions) {
        const actual = standingsByTeam.get(pred.team_name)
        if (actual === undefined) {
          continue
        }
        const { gp, bk, bl, b3, total_points } = computeTeamScore(
          pred.predicted_position,
          actual
        )
        scoreRows.push({
          user_id: userId,
          team_name: pred.team_name,
          predicted_position: pred.predicted_position,
          actual_position: actual,
          gp,
          bk,
          bl,
          b3,
          total_points,
          season,
        })
      }
    }

    const { error: deleteError } = await supabase.from('score_details').delete().eq('season', season)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    if (scoreRows.length > 0) {
      const chunkSize = 200
      for (let i = 0; i < scoreRows.length; i += chunkSize) {
        const chunk = scoreRows.slice(i, i + chunkSize)
        const { error: insertError } = await supabase.from('score_details').insert(chunk)
        if (insertError) {
          return NextResponse.json({ error: insertError.message }, { status: 500 })
        }
      }
    }

    const totalsByUser = new Map<string, number>()
    for (const row of scoreRows) {
      totalsByUser.set(row.user_id, (totalsByUser.get(row.user_id) ?? 0) + row.total_points)
    }

    const leaderboardUpserts = Array.from(totalsByUser.entries()).map(([user_id, points]) => ({
      user_id,
      points,
      updated_at: new Date().toISOString(),
    }))

    if (leaderboardUpserts.length > 0) {
      const { error: leaderboardError } = await supabase
        .from('leaderboard')
        .upsert(leaderboardUpserts, { onConflict: 'user_id' })

      if (leaderboardError) {
        return NextResponse.json({ error: leaderboardError.message }, { status: 500 })
      }
    }

    return NextResponse.json({
      season,
      teamsInStandings: standings.length,
      scoreDetailRows: scoreRows.length,
      usersUpdated: totalsByUser.size,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Recalculation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
