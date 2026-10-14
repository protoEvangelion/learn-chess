import {
  EXPLORER_MOVE_CAP,
  EXPLORER_SPEEDS,
  isExplorerMonth,
  isExplorerSpeed,
  isRatingBandId,
  lichessExplorerUrl,
  normalizeMonths,
  normalizeRatings,
  normalizeSpeeds,
  parseExplorerPosition,
  type ExplorerMonth,
  type ExplorerPosition,
  type ExplorerQueryOptions,
  type ExplorerSpeed,
  type RatingBandId,
} from '../src/lib/lichessExplorer.js'

const UCI_PLAY =
  /^([a-h][1-8][a-h][1-8][qrbn]?)(,[a-h][1-8][a-h][1-8][qrbn]?)*$/

const USER_AGENT = 'learn-chess (https://learn-chess-fawn.vercel.app)'

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
  if (!fen || fen.length > 200) return { error: 'fen is required' }
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
  const months = normalizeMonths(monthParts)
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

/**
 * Server-side explorer call. Anonymous requests get nginx 401; the token
 * stays on the server.
 */
export async function fetchExplorerWithToken(
  fen: string,
  ratings: readonly RatingBandId[],
  signal?: AbortSignal,
  options: ExplorerQueryOptions = {},
): Promise<{ position: ExplorerPosition; upstream: string }> {
  const token = (
    process.env.LICHESS_API_TOKEN || process.env.LICHESS_TOKEN
  )?.trim()
  if (!token) {
    throw new Error(
      'Set LICHESS_API_TOKEN (or LICHESS_TOKEN) on the server to a Lichess personal API token from https://lichess.org/account/oauth/token. Anonymous explorer requests are rejected.',
    )
  }
  const upstream = lichessExplorerUrl(fen, ratings, options)
  let res: Response
  try {
    res = await fetch(upstream, {
      signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
      },
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error("Couldn't reach the Lichess explorer.")
  }
  if (res.status === 401) {
    throw new Error(
      'Lichess rejected LICHESS_API_TOKEN. Create a personal token at https://lichess.org/account/oauth/token and set that env var on the server.',
    )
  }
  if (!res.ok) {
    throw new Error(`Lichess explorer returned ${res.status}.`)
  }
  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    throw new Error('Lichess explorer returned an unreadable response.')
  }
  return { position: parseExplorerPosition(payload), upstream }
}
