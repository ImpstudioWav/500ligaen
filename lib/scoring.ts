/**
 * Scoring rules (per team, compare predicted vs actual table position).
 * GP: max(0, 16 - 2 * |pred - actual|)
 * BK: exact match -> +8
 * BL: distance 1 -> +5, distance 2 -> +2
 * B3: exact match and actual in top 3 (1–3) or bottom 3 (14–16) -> +10
 */
export function computeTeamScore(predictedPosition: number, actualPosition: number) {
  const distance = Math.abs(predictedPosition - actualPosition)
  const gp = Math.max(0, 16 - 2 * distance)

  let bk = 0
  if (predictedPosition === actualPosition) {
    bk = 8
  }

  let bl = 0
  if (distance === 1) {
    bl = 5
  } else if (distance === 2) {
    bl = 2
  }

  let b3 = 0
  if (predictedPosition === actualPosition) {
    const inTop3 = actualPosition >= 1 && actualPosition <= 3
    const inBottom3 = actualPosition >= 14 && actualPosition <= 16
    if (inTop3 || inBottom3) {
      b3 = 10
    }
  }

  const total_points = gp + bk + bl + b3

  return { gp, bk, bl, b3, total_points }
}
