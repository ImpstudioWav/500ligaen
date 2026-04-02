import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { computeTeamScore } from '@/lib/scoring'

async function getUserIdFromBearer(request: Request): Promise<string | null> {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  if (!token) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  const authClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser()
  if (error || !user) return null
  return user.id
}

/** Secret header match OR logged-in user with profiles.is_admin = true. Never "open" when env secret is missing. */
async function isRecalcAuthorized(request: Request): Promise<boolean> {
  const secret = process.env.RECALCULATE_SCORES_SECRET
  const header = request.headers.get('x-recalc-secret')
  if (secret && header === secret) {
    return true
  }

  const userId = await getUserIdFromBearer(request)
  if (!userId) return false

  const supabase = getSupabaseAdmin()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .maybeSingle()

  if (error || !profile) return false
  return (profile as { is_admin: boolean | null }).is_admin === true
}

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

function parseLeagueId(body: Record<string, unknown>): string | null {
  const raw = body.leagueId ?? body.league_id
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function POST(request: Request) {
  const authorized = await isRecalcAuthorized(request)
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const leagueId = parseLeagueId(body)
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const season = parseSeason(body.season)

  try {
    const supabase = getSupabaseAdmin()

    const { data: standings, error: standingsError } = await supabase
      .from('standings')
      .select('team_name, actual_position, season')
      .eq('league_id', leagueId)
      .eq('season', season)

    if (standingsError) {
      return NextResponse.json({ error: standingsError.message }, { status: 500 })
    }

    if (!standings?.length) {
      return NextResponse.json(
        {
          error: `Ingen tabell funnet for leagueId=${leagueId}, season=${season}`,
        },
        { status: 400 }
      )
    }

    const { data: predictions, error: predictionsError } = await supabase
      .from('predictions')
      .select('user_id, team_name, predicted_position')
      .eq('league_id', leagueId)

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
      league_id: string
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
          league_id: leagueId,
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

    const { error: deleteError } = await supabase
      .from('score_details')
      .delete()
      .eq('league_id', leagueId)
      .eq('season', season)

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
      league_id: leagueId,
      user_id,
      points,
      updated_at: new Date().toISOString(),
    }))

    if (leaderboardUpserts.length > 0) {
      const { error: leaderboardError } = await supabase.from('leaderboard').upsert(
        leaderboardUpserts,
        { onConflict: 'league_id,user_id' }
      )

      if (leaderboardError) {
        return NextResponse.json({ error: leaderboardError.message }, { status: 500 })
      }
    }

    return NextResponse.json({
      leagueId,
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
