/**
 * Icons on the explorer move list.
 * Best and worst use the saved engine score (the same UCI the board already
 * fetched). Popularity is the move with the most games. Highest and lowest
 * win rate use the percent the Win column already prints, and only rows
 * where that cell is filled in.
 */

export type MoveMark = 'best' | 'worst' | 'popular' | 'highest' | 'lowest'

export const MOVE_MARK_GLYPH: Record<MoveMark, string> = {
  best: '★',
  worst: '✕',
  popular: '👥',
  highest: '📈',
  lowest: '📉',
}

export const MOVE_MARK_HINT: Record<MoveMark, string> = {
  best: 'Best move',
  worst: 'Worst move',
  popular: 'Most popular',
  highest: 'Highest win rate',
  lowest: 'Lowest win rate',
}

const MARK_ORDER: readonly MoveMark[] = [
  'best',
  'worst',
  'popular',
  'highest',
  'lowest',
]

type MarkRow = {
  id: string
  san: string
  kind: string
  path: string[]
  play: string
  games: number
  subRows?: readonly MarkRow[]
}

function sanKey(san: string) {
  return san.replace(/[+#]$/, '')
}

/** Next-move row whose UCI is the last move of `play`. */
function rowPlaysUci(
  row: MarkRow,
  uci: string | null | undefined,
  playedLen: number,
) {
  if (!uci || row.kind === 'status') return false
  if (row.path.length !== playedLen + 1) return false
  const parts = row.play.split(',')
  return parts[parts.length - 1] === uci
}

function collectRows(rows: readonly MarkRow[], into: MarkRow[]) {
  for (const row of rows) {
    if (row.kind !== 'status') into.push(row)
    if (row.subRows) collectRows(row.subRows, into)
  }
}

/** Replies from the position after `playedSans`. Not a different expanded line. */
function currentReplies(rows: readonly MarkRow[], played: readonly string[]): MarkRow[] {
  let list = rows
  for (let i = 0; i < played.length; i += 1) {
    const want = sanKey(played[i] ?? '')
    const match = list.find(
      (row) => row.kind !== 'status' && sanKey(row.san) === want,
    )
    if (!match?.subRows) return []
    list = match.subRows
  }
  return list.filter((row) => row.kind !== 'status')
}

/**
 * Ids at the high end and the low end.
 * One value, or a tie across every scored row, marks neither end.
 */
function extremes(
  rows: readonly MarkRow[],
  value: (row: MarkRow) => number | null,
): { high: Set<string>; low: Set<string> } {
  const highIds = new Set<string>()
  const lowIds = new Set<string>()
  let high: number | null = null
  let low: number | null = null
  const scored: { id: string; n: number }[] = []
  for (const row of rows) {
    const n = value(row)
    if (n === null) continue
    scored.push({ id: row.id, n })
    high = high === null ? n : Math.max(high, n)
    low = low === null ? n : Math.min(low, n)
  }
  if (high === null || low === null || high === low) return { high: highIds, low: lowIds }
  for (const item of scored) {
    if (item.n === high) highIds.add(item.id)
    if (item.n === low) lowIds.add(item.id)
  }
  return { high: highIds, low: lowIds }
}

export function explorerMoveMarks<T extends MarkRow>(input: {
  rows: readonly T[]
  playedSans: readonly string[]
  recommendedUci: string | null | undefined
  worstUci: string | null | undefined
  /** Printed Win-column percent, or null when that cell is blank. */
  shownWin: (row: T) => number | null
}): Map<string, MoveMark[]> {
  const map = new Map<string, Set<MoveMark>>()
  const add = (id: string, mark: MoveMark) => {
    const set = map.get(id)
    if (set) set.add(mark)
    else map.set(id, new Set([mark]))
  }

  const playedLen = input.playedSans.length
  const all: MarkRow[] = []
  collectRows(input.rows, all)
  for (const row of all) {
    if (rowPlaysUci(row, input.recommendedUci, playedLen)) add(row.id, 'best')
    if (
      input.worstUci &&
      input.worstUci !== input.recommendedUci &&
      rowPlaysUci(row, input.worstUci, playedLen)
    ) {
      add(row.id, 'worst')
    }
  }

  const replies = currentReplies(input.rows, input.playedSans)
  const popular = extremes(replies, (row) => row.games)
  const wins = extremes(replies, (row) => input.shownWin(row as T))
  for (const row of replies) {
    if (popular.high.has(row.id)) add(row.id, 'popular')
    if (wins.high.has(row.id)) add(row.id, 'highest')
    if (wins.low.has(row.id)) add(row.id, 'lowest')
  }

  const ordered = new Map<string, MoveMark[]>()
  for (const [id, set] of map) {
    ordered.set(
      id,
      MARK_ORDER.filter((mark) => set.has(mark)),
    )
  }
  return ordered
}
