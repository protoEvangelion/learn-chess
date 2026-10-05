/**
 * Lichess Opening Explorer — rated games by rating band.
 * Spec: https://github.com/lichess-org/api/blob/master/doc/specs/tags/openingexplorer/lichess.yaml
 *
 * The explorer responds with Access-Control-Allow-Origin: * and does not
 * require an API key. Call it from the browser.
 */

export const LICHESS_EXPLORER_ENDPOINT = 'https://explorer.lichess.org/lichess'

export const EXPLORER_SPEEDS = 'blitz,rapid,classical'
export const EXPLORER_MOVE_CAP = 8

/** Average of both players. Each band runs from its value up to the next. */
export const RATING_BANDS = [
  { id: '0', label: '0–999' },
  { id: '1000', label: '1000–1199' },
  { id: '1200', label: '1200–1399' },
  { id: '1400', label: '1400–1599' },
  { id: '1600', label: '1600–1799' },
  { id: '1800', label: '1800–1999' },
  { id: '2000', label: '2000–2199' },
  { id: '2200', label: '2200–2499' },
  { id: '2500', label: '2500+' },
] as const

export type RatingBandId = (typeof RATING_BANDS)[number]['id']

export const DEFAULT_RATING_BAND: RatingBandId = '1600'

export function isRatingBandId(value: string): value is RatingBandId {
  return RATING_BANDS.some((band) => band.id === value)
}

export type ExplorerMove = {
  san: string
  uci: string
  averageRating: number
  white: number
  draws: number
  black: number
}

export type ExplorerPosition = {
  white: number
  draws: number
  black: number
  moves: ExplorerMove[]
  /** Explorer is still indexing this position. */
  queued: boolean
}

/** Query string matching the official example (slashes left intact, spaces as %20). */
export function lichessExplorerUrl(fen: string, rating: RatingBandId): string {
  const fenParam = encodeURIComponent(fen).replace(/%2F/g, '/')
  const query = [
    `fen=${fenParam}`,
    'variant=standard',
    `speeds=${EXPLORER_SPEEDS}`,
    `ratings=${rating}`,
    `moves=${EXPLORER_MOVE_CAP}`,
    'topGames=0',
    'recentGames=0',
  ].join('&')
  return `${LICHESS_EXPLORER_ENDPOINT}?${query}`
}

function readCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

function parseMove(value: unknown): ExplorerMove | null {
  if (!value || typeof value !== 'object') return null
  const move = value as Record<string, unknown>
  if (typeof move.san !== 'string' || move.san.trim() === '') return null
  if (typeof move.uci !== 'string' || move.uci.trim() === '') return null
  return {
    san: move.san,
    uci: move.uci,
    averageRating: readCount(move.averageRating),
    white: readCount(move.white),
    draws: readCount(move.draws),
    black: readCount(move.black),
  }
}

export function parseExplorerPosition(payload: unknown): ExplorerPosition {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Lichess explorer returned an unexpected response.')
  }
  const body = payload as Record<string, unknown>
  const rawMoves = Array.isArray(body.moves) ? body.moves : []
  const moves: ExplorerMove[] = []
  for (const item of rawMoves) {
    if (moves.length >= EXPLORER_MOVE_CAP) break
    const move = parseMove(item)
    if (move) moves.push(move)
  }
  const queuePosition = body.queuePosition
  return {
    white: readCount(body.white),
    draws: readCount(body.draws),
    black: readCount(body.black),
    moves,
    queued: typeof queuePosition === 'number' && queuePosition > 0,
  }
}

export function explorerGames(move: {
  white: number
  draws: number
  black: number
}): number {
  return move.white + move.draws + move.black
}

export async function fetchLichessExplorer(
  fen: string,
  rating: RatingBandId,
  signal: AbortSignal,
): Promise<ExplorerPosition> {
  const url = lichessExplorerUrl(fen, rating)
  let res: Response
  try {
    res = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error("Couldn't reach the Lichess explorer.")
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
  return parseExplorerPosition(payload)
}
