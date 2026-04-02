export type PredictionWindowState = 'before_open' | 'open' | 'closed'

export function resolvePredictionWindow(
  openAt: string | null,
  closeAt: string | null,
  now: Date
): PredictionWindowState {
  const t = now.getTime()
  const openMs = openAt ? new Date(openAt).getTime() : null
  const closeMs = closeAt ? new Date(closeAt).getTime() : null
  if (openMs !== null && !Number.isNaN(openMs) && t < openMs) {
    return 'before_open'
  }
  if (closeMs !== null && !Number.isNaN(closeMs) && t > closeMs) {
    return 'closed'
  }
  return 'open'
}

/** Remaining time from `now` until `targetIso`, formatted with d / t / min / sek. */
export function formatPredictionCountdown(targetIso: string, now: Date): string {
  const end = new Date(targetIso).getTime()
  if (Number.isNaN(end)) return '—'
  let ms = end - now.getTime()
  if (ms <= 0) return '0 sek'
  const totalSec = Math.floor(ms / 1000)
  const days = Math.floor(totalSec / 86400)
  let r = totalSec % 86400
  const hours = Math.floor(r / 3600)
  r %= 3600
  const minutes = Math.floor(r / 60)
  const seconds = r % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days} ${days === 1 ? 'dag' : 'dager'}`)
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'time' : 'timer'}`)
  if (minutes > 0) parts.push(`${minutes} min`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} sek`)
  return parts.join(' ')
}

/** Short label for hub cards: prefix + countdown, or fixed text when closed. */
export function predictionHubStatusLine(
  openAt: string | null,
  closeAt: string | null,
  now: Date
): string | null {
  const win = resolvePredictionWindow(openAt, closeAt, now)
  if (win === 'before_open' && openAt) {
    return `Åpner om ${formatPredictionCountdown(openAt, now)}`
  }
  if (win === 'open' && closeAt) {
    return `Stenger om ${formatPredictionCountdown(closeAt, now)}`
  }
  if (win === 'closed') {
    return 'Stengt'
  }
  return null
}
