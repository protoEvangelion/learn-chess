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
/**
 * Lichess defaults this to 12, which hides rare first moves such as a4.
 * 100 covers every legal reply in a normal opening position.
 */
export const EXPLORER_MOVE_CAP = 100

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
  /** Named opening of this position, when Lichess has one. */
  opening: ExplorerOpening | null
  /** Explorer is still indexing this position. */
  queued: boolean
}

export type BranchMover = 'white' | 'black'

export type OpeningBranchLine = {
  name: string
  eco: string
  /** SAN of the move from the parent position into this line. */
  san?: string
  /** UCI path from the start position that reaches this named line. */
  play?: string
  white: number
  draws: number
  black: number
  averageRating: number
  /** Side that played the move which reached this line. */
  mover: BranchMover
}

export type OpeningBranch = {
  opening: ExplorerOpening | null
  lines: OpeningBranchLine[]
}

/** A named Black defense reached by a White first move plus Black's reply. */
export type BlackDefense = {
  san: string
  eco: string
  name: string
  white: number
  draws: number
  black: number
  averageRating: number
}

export type BlackDefenseList = {
  total: number
  defenses: BlackDefense[]
}

/** True when `name` is a named choice under `parentName` (`Parent: …` or `Parent, …`). */
export function isOpeningVariation(parentName: string, name: string): boolean {
  if (!parentName) return false
  return name.startsWith(`${parentName}: `) || name.startsWith(`${parentName}, `)
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
  const moveCap = options.moves ?? EXPLORER_MOVE_CAP
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
    opening: parseOpening(body.opening),
    queued: typeof queuePosition === 'number' && queuePosition > 0,
  }
}

function parseMover(value: unknown): BranchMover {
  return value === 'black' ? 'black' : 'white'
}

export function parseOpeningBranch(payload: unknown): OpeningBranch {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Opening branch returned an unexpected response.')
  }
  const body = payload as Record<string, unknown>
  const rawLines = Array.isArray(body.lines) ? body.lines : []
  const lines: OpeningBranchLine[] = []
  for (const item of rawLines) {
    if (!item || typeof item !== 'object') continue
    const line = item as Record<string, unknown>
    if (typeof line.name !== 'string' || line.name.trim() === '') continue
    lines.push({
      name: line.name.trim(),
      eco: typeof line.eco === 'string' ? line.eco : '',
      san: typeof line.san === 'string' ? line.san.trim() : '',
      play: typeof line.play === 'string' ? line.play.trim() : '',
      white: readCount(line.white),
      draws: readCount(line.draws),
      black: readCount(line.black),
      averageRating: readCount(line.averageRating),
      mover: parseMover(line.mover),
    })
  }
  return { opening: parseOpening(body.opening), lines }
}

/** Win rate of the side that played the line. Black replies use Black's score. */
export function sideWinRate(line: {
  white: number
  draws: number
  black: number
  mover: BranchMover
}): number {
  const total = line.white + line.draws + line.black
  if (total <= 0) return -1
  return (line.mover === 'black' ? line.black : line.white) / total
}

/** White's score. Empty totals sort last. */
export function whiteWinRate(line: {
  white: number
  draws: number
  black: number
}): number {
  const total = line.white + line.draws + line.black
  if (total <= 0) return -1
  return line.white / total
}

/** Black's score. Empty totals sort last. */
export function blackWinRate(line: {
  white: number
  draws: number
  black: number
}): number {
  const total = line.white + line.draws + line.black
  if (total <= 0) return -1
  return line.black / total
}

/** Highest win rate for `side` first. Lines with no games stay last. */
export function sortByWinRate<T extends { white: number; draws: number; black: number }>(
  rows: readonly T[],
  side: 'white' | 'black',
  label: (row: T) => string,
): T[] {
  const rate = side === 'black' ? blackWinRate : whiteWinRate
  return [...rows].sort((a, b) => {
    const delta = rate(b) - rate(a)
    if (delta !== 0) return delta
    return label(a).localeCompare(label(b), 'en')
  })
}

export function sortBranchLines<T extends OpeningBranchLine>(lines: readonly T[]): T[] {
  return sortByWinRate(lines, 'white', (line) => line.name)
}

export function sortBlackDefenses<T extends BlackDefense>(
  defenses: readonly T[],
): T[] {
  return sortByWinRate(defenses, 'black', (line) => line.name)
}

/** a3, a4, b3, b4, … then piece moves. Letter order, not popularity. */
export function sortBySan<T extends { san: string }>(groups: readonly T[]): T[] {
  return [...groups].sort((a, b) =>
    a.san.toLowerCase().localeCompare(b.san.toLowerCase(), 'en', { numeric: true }),
  )
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

export function openingBranchApiUrl(
  fen: string,
  ratings: readonly RatingBandId[],
  play: string,
): string {
  return `/api/opening-branch?${lichessExplorerQuery(fen, ratings, {
    play,
    moves: EXPLORER_MOVE_CAP,
  })}`
}

export async function fetchOpeningBranch(
  fen: string,
  ratings: readonly RatingBandId[],
  play: string,
  signal: AbortSignal,
): Promise<OpeningBranch> {
  const url = openingBranchApiUrl(fen, ratings, play)
  let res: Response
  try {
    res = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error("Couldn't reach the opening tree.")
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
        : `Opening tree returned ${res.status}.`
    throw new Error(message)
  }
  return parseOpeningBranch(payload)
}

export function parseBlackDefenses(payload: unknown): BlackDefenseList {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Opening defenses returned an unexpected response.')
  }
  const body = payload as Record<string, unknown>
  const raw = Array.isArray(body.defenses) ? body.defenses : []
  const defenses: BlackDefense[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.name !== 'string' || row.name.trim() === '') continue
    if (typeof row.san !== 'string' || row.san.trim() === '') continue
    defenses.push({
      san: row.san.trim(),
      eco: typeof row.eco === 'string' ? row.eco : '',
      name: row.name.trim(),
      white: readCount(row.white),
      draws: readCount(row.draws),
      black: readCount(row.black),
      averageRating: readCount(row.averageRating),
    })
  }
  return { total: readCount(body.total), defenses }
}

export function openingDefensesApiUrl(
  fen: string,
  ratings: readonly RatingBandId[],
): string {
  return `/api/opening-defenses?${lichessExplorerQuery(fen, ratings, {
    moves: EXPLORER_MOVE_CAP,
  })}`
}

export async function fetchBlackDefenses(
  fen: string,
  ratings: readonly RatingBandId[],
  signal: AbortSignal,
): Promise<BlackDefenseList> {
  const url = openingDefensesApiUrl(fen, ratings)
  let res: Response
  try {
    res = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error("Couldn't reach the opening defenses.")
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
        : `Opening defenses returned ${res.status}.`
    throw new Error(message)
  }
  return parseBlackDefenses(payload)
}
