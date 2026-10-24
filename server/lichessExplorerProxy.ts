import {
  EXPLORER_MOVE_CAP,
  EXPLORER_SPEEDS,
  isExplorerMonth,
  isExplorerSpeed,
  isRatingBandId,
  normalizeMonths,
  normalizeRatings,
  normalizeSpeeds,
  type ExplorerMonth,
  type ExplorerQueryOptions,
  type ExplorerSpeed,
  type RatingBandId,
} from '../src/lib/lichessExplorer.js'

const UCI_PLAY =
  /^([a-h][1-8][a-h][1-8][qrbn]?)(,[a-h][1-8][a-h][1-8][qrbn]?)*$/
const FEN_RE = /^[a-zA-Z0-9/+.\- ]{1,200}$/
const MAX_PLAY = 80
const MAX_MONTHS = 24

export function readExplorerQuery(
  rawUrl: string | undefined,
):
  | {
      fen: string
      ratings: RatingBandId[]
      speeds: ExplorerSpeed[]
      months: ExplorerMonth[]
      options: ExplorerQueryOptions
    }
  | { error: string } {
  const query = new URL(rawUrl ?? '', 'http://localhost').searchParams
  const fen = query.get('fen')?.trim() ?? ''
  const ratingRaw = query.get('ratings')?.trim() ?? ''
  const speedRaw = query.get('speeds')?.trim() ?? ''
  const monthRaw = query.get('months')?.trim() ?? ''
  const play = query.get('play')?.trim() ?? ''
  const movesRaw = Number(query.get('moves'))
  if (!FEN_RE.test(fen)) return { error: 'fen is required' }
  const parts = ratingRaw.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0 || parts.some((part) => !isRatingBandId(part))) {
    return { error: 'ratings must be one or more bands' }
  }
  const ratings = normalizeRatings(
    parts.filter((part): part is RatingBandId => isRatingBandId(part)),
  )
  const speedParts = speedRaw.split(',').map((part) => part.trim()).filter(Boolean)
  if (speedParts.some((part) => !isExplorerSpeed(part))) {
    return { error: 'speeds must be ultraBullet, bullet, blitz, rapid, classical, or correspondence' }
  }
  const speeds = normalizeSpeeds(speedParts.length > 0 ? speedParts : EXPLORER_SPEEDS)
  const monthParts = monthRaw.split(',').map((part) => part.trim()).filter(Boolean)
  if (monthParts.some((part) => !isExplorerMonth(part))) {
    return { error: 'months must be YYYY-MM values the explorer knows' }
  }
  if (monthParts.length > MAX_MONTHS) return { error: 'too many months' }
  const months = normalizeMonths(monthParts)
  const playMoves = play ? play.split(',') : []
  if (playMoves.length > MAX_PLAY) return { error: 'play is too long' }
  if (play && !UCI_PLAY.test(play)) return { error: 'play must be UCI moves' }
  const moves =
    Number.isInteger(movesRaw) && movesRaw >= 1
      ? Math.min(movesRaw, EXPLORER_MOVE_CAP)
      : EXPLORER_MOVE_CAP
  return {
    fen,
    ratings,
    speeds,
    months,
    options: { play: play || undefined, moves, speeds, months },
  }
}
