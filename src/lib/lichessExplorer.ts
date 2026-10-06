/**
 * Lichess Opening Explorer — rated games by rating band.
 * Spec: https://github.com/lichess-org/api/blob/master/doc/specs/tags/openingexplorer/lichess.yaml
 *
 * Since March 2026 the explorer rejects anonymous requests (nginx 401).
 * The browser calls the same-origin proxy `/api/opening-explorer`, which
 * adds `Authorization: Bearer ${LICHESS_API_TOKEN}` on the server.
 */

export const LICHESS_EXPLORER_ENDPOINT = 'https://explorer.lichess.org/lichess'

export const EXPLORER_SPEEDS = 'blitz,rapid,classical'
export const EXPLORER_MOVE_CAP = 12

/** Average of both players. Each band runs from its value up to the next. */
export const RATING_BANDS = [
  { id: '0', label: '0/400' },
  { id: '1000', label: '1000' },
  { id: '1200', label: '1200' },
  { id: '1400', label: '1400' },
  { id: '1600', label: '1600' },
  { id: '1800', label: '1800' },
  { id: '2000', label: '2000' },
  { id: '2200', label: '2200' },
  { id: '2500', label: '2500' },
] as const

export type RatingBandId = (typeof RATING_BANDS)[number]['id']

export const DEFAULT_RATING_BAND: RatingBandId = '1600'

export function isRatingBandId(value: string): value is RatingBandId {
  return RATING_BANDS.some((band) => band.id === value)
}

export type ExplorerOpening = {
  eco: string
  name: string
}

export type ExplorerMove = {
  san: string
  uci: string
  averageRating: number
  white: number
  draws: number
  black: number
  /** Named opening reached by playing this move, when Lichess has one. */
  opening: ExplorerOpening | null
}

export type ExplorerPosition = {
  white: number
  draws: number
  black: number
  moves: ExplorerMove[]
  /** Explorer is still indexing this position. */
  queued: boolean
}

export type ExplorerQueryOptions = {
  /** Comma-separated UCI moves played from `fen`. Needed for opening names. */
  play?: string
  moves?: number
}

/** Bands in Lichess enum order, duplicates dropped. */
export function normalizeRatings(ratings: readonly RatingBandId[]): RatingBandId[] {
  const selected = new Set(ratings)
  return RATING_BANDS.map((band) => band.id).filter((id) => selected.has(id))
}

/** Query string matching the official example (slashes left intact, spaces as %20). */
export function lichessExplorerQuery(
  fen: string,
  ratings: readonly RatingBandId[],
  options: ExplorerQueryOptions = {},
): string {
  const fenParam = encodeURIComponent(fen).replace(/%2F/g, '/')
  const bandList = normalizeRatings(ratings)
  const moveCap = options.moves ?? 8
  const parts = [
    `fen=${fenParam}`,
    'variant=standard',
    `speeds=${EXPLORER_SPEEDS}`,
    `ratings=${bandList.join(',')}`,
    `moves=${moveCap}`,
    'topGames=0',
    'recentGames=0',
  ]
  if (options.play) parts.push(`play=${options.play}`)
  return parts.join('&')
}

export function lichessExplorerUrl(
  fen: string,
  ratings: readonly RatingBandId[],
  options: ExplorerQueryOptions = {},
): string {
  return `${LICHESS_EXPLORER_ENDPOINT}?${lichessExplorerQuery(fen, ratings, options)}`
}

/** Same-origin request the Explore tab actually sends. */
export function openingExplorerApiUrl(
  fen: string,
  ratings: readonly RatingBandId[],
  options: ExplorerQueryOptions = {},
): string {
  return `/api/opening-explorer?${lichessExplorerQuery(fen, ratings, options)}`
}

function readCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

function parseOpening(value: unknown): ExplorerOpening | null {
  if (!value || typeof value !== 'object') return null
  const opening = value as Record<string, unknown>
  if (typeof opening.name !== 'string' || opening.name.trim() === '') return null
  return {
    eco: typeof opening.eco === 'string' ? opening.eco : '',
    name: opening.name.trim(),
  }
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
    opening: parseOpening(move.opening),
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
  ratings: readonly RatingBandId[],
  signal: AbortSignal,
  options: ExplorerQueryOptions = {},
): Promise<ExplorerPosition> {
  const url = openingExplorerApiUrl(fen, ratings, options)
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
  let payload: unknown = null
  try {
    payload = await res.json()
  } catch {
    payload = null
  }
  if (!res.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `Lichess explorer returned ${res.status}.`
    throw new Error(message)
  }
  return parseExplorerPosition(payload)
}
