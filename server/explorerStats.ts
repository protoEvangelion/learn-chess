import { Chess } from 'chess.js'
import { getExplorerDb, listExplorerSources } from './explorerDb.js'
import { loadOpeningBook, positionKey, type BookLine } from './openingBook.js'
import {
  EXPLORER_MOVE_CAP,
  EXPLORER_SPEEDS,
  normalizeSpeeds,
  normalizeMonths,
  type ExplorerMonth,
  type ExplorerMove,
  type ExplorerOpening,
  type ExplorerPosition,
  type ExplorerSpeed,
  type RatingBandId,
} from '../src/lib/lichessExplorer.js'

type NameIndex = Map<string, ExplorerOpening>

function num(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value) return Number(value)
  return 0
}

function indexBook(lines: readonly BookLine[]): NameIndex {
  const byMoves: NameIndex = new Map()
  for (const line of lines) {
    const key = line.uci.join(',')
    if (!byMoves.has(key)) byMoves.set(key, { eco: line.eco, name: line.name })
  }
  return byMoves
}

/** Book line whose moves are exactly `uci`, when one exists. */
function exactOpening(index: NameIndex, uci: readonly string[]): ExplorerOpening | null {
  if (uci.length === 0) return null
  return index.get(uci.join(',')) ?? null
}

/** Longest opening whose moves are a prefix of `uci`. */
function openingFor(index: NameIndex, uci: readonly string[]): ExplorerOpening | null {
  for (let length = uci.length; length >= 1; length -= 1) {
    const hit = index.get(uci.slice(0, length).join(','))
    if (hit) return hit
  }
  return null
}

let monthColumn: Promise<boolean> | null = null

/** The live file has no month until the next build. All-time queries skip the column. */
/** Months attached for the explorer, earliest first. */
export async function listExplorerMonths(): Promise<string[]> {
  const sources = await listExplorerSources()
  return sources.map((source) => source.month)
}

function explorerHasMonth(): Promise<boolean> {
  if (!monthColumn) {
    monthColumn = getExplorerDb()
      .execute("SELECT name FROM pragma_table_info('explorer_move')")
      .then((result) => result.rows.some((row) => String(row.name ?? '') === 'month'))
      .catch(() => false)
  }
  return monthColumn
}

function mergeMoveRows(
  rows: readonly Record<string, unknown>[],
): { uci: unknown; san: unknown; white: unknown; draws: unknown; black: unknown }[] {
  const byKey = new Map<string, { uci: string; san: string; white: number; draws: number; black: number }>()
  for (const row of rows) {
    const uci = String(row.uci ?? '')
    const san = String(row.san ?? '')
    const key = `${uci}\0${san}`
    const prev = byKey.get(key)
    if (prev) {
      prev.white += num(row.white)
      prev.draws += num(row.draws)
      prev.black += num(row.black)
      continue
    }
    byKey.set(key, {
      uci,
      san,
      white: num(row.white),
      draws: num(row.draws),
      black: num(row.black),
    })
  }
  return [...byKey.values()]
}

function winRate(white: number, draws: number, black: number, side: 'w' | 'b') {
  const games = white + draws + black
  if (games <= 0) return -1
  return (side === 'w' ? white : black) / games
}

/**
 * Counts for one board from `explorer_move` and `explorer_position`.
 * `play` is UCI moves from `fen`. Names come from the opening book.
 */
export async function queryExplorerPosition(
  fen: string,
  ratings: readonly RatingBandId[],
  play = '',
  speeds: readonly ExplorerSpeed[] = EXPLORER_SPEEDS,
  months: readonly ExplorerMonth[] = [],
): Promise<ExplorerPosition> {
  const chess = new Chess(fen)
  const uciPath: string[] = []
  for (const step of play.split(',').filter(Boolean)) {
    const played = chess.move({
      from: step.slice(0, 2),
      to: step.slice(2, 4),
      promotion: step[4] || undefined,
    })
    if (!played) throw new Error(`illegal explorer play ${step}`)
    uciPath.push(`${played.from}${played.to}${played.promotion ?? ''}`)
  }
  const key = positionKey(chess.fen())
  const selectedSpeeds = normalizeSpeeds(speeds)
  const selectedMonths = normalizeMonths(months)
  const hasMonth = selectedMonths.length > 0 && (await explorerHasMonth())
  const bandPlace = ratings.map(() => '?').join(', ')
  const speedPlace = selectedSpeeds.map(() => '?').join(', ')
  const monthPlace = selectedMonths.map(() => '?').join(', ')
  const monthSql = hasMonth ? `AND month IN (${monthPlace})` : ''
  const args = [
    key,
    ...ratings,
    ...selectedSpeeds,
    ...(hasMonth ? selectedMonths : []),
  ]
  const sources = await listExplorerSources()
  const active =
    sources.length === 0
      ? [{ month: '', db: getExplorerDb() }]
      : selectedMonths.length > 0
        ? sources.filter((source) => selectedMonths.includes(source.month))
        : sources
  let moveRows: { uci: unknown; san: unknown; white: unknown; draws: unknown; black: unknown }[]
  let totals: { white: unknown; draws: unknown; black: unknown } | undefined
  let bookLines: BookLine[]
  try {
    const [moveResults, positionResults, book] = await Promise.all([
      Promise.all(
        active.map((source) =>
          source.db.execute({
            sql: `
              SELECT uci, san,
                     SUM(white) AS white,
                     SUM(draws) AS draws,
                     SUM(black) AS black
              FROM explorer_move
              WHERE position = ?
                AND rating_band IN (${bandPlace})
                AND speed IN (${speedPlace})
                ${monthSql}
              GROUP BY uci, san
            `,
            args,
          }),
        ),
      ),
      Promise.all(
        active.map((source) =>
          source.db.execute({
            sql: `
              SELECT SUM(white) AS white,
                     SUM(draws) AS draws,
                     SUM(black) AS black
              FROM explorer_position
              WHERE position = ?
                AND rating_band IN (${bandPlace})
                AND speed IN (${speedPlace})
                ${monthSql}
            `,
            args,
          }),
        ),
      ),
      loadOpeningBook(),
    ])
    moveRows = mergeMoveRows(moveResults.flatMap((result) => result.rows))
    const positionRows = positionResults.map((result) => result.rows[0])
    totals = {
      white: positionRows.reduce((sum, row) => sum + num(row?.white), 0),
      draws: positionRows.reduce((sum, row) => sum + num(row?.draws), 0),
      black: positionRows.reduce((sum, row) => sum + num(row?.black), 0),
    }
    bookLines = book.lines
  } catch (err) {
    const message = err instanceof Error ? err.message : 'explorer query failed'
    if (/no such table/i.test(message)) {
      throw new Error('Explorer counts are not loaded yet. Run npm run build:explorer.')
    }
    throw err instanceof Error ? err : new Error(message)
  }

  const names = indexBook(bookLines)
  const side = chess.turn()
  const moves: ExplorerMove[] = moveRows
    .map((row) => {
      const uci = String(row.uci ?? '')
      const white = num(row.white)
      const draws = num(row.draws)
      const black = num(row.black)
      return {
        san: String(row.san ?? ''),
        uci,
        averageRating: 0,
        white,
        draws,
        black,
        opening: exactOpening(names, [...uciPath, uci]),
      }
    })
    .filter((move) => move.uci && move.white + move.draws + move.black > 0)
    .sort((a, b) => {
      const delta = winRate(b.white, b.draws, b.black, side) - winRate(a.white, a.draws, a.black, side)
      if (delta !== 0) return delta
      return a.san.localeCompare(b.san, 'en')
    })
    .slice(0, EXPLORER_MOVE_CAP)

  return {
    white: num(totals?.white),
    draws: num(totals?.draws),
    black: num(totals?.black),
    moves,
    opening: openingFor(names, uciPath),
    queued: false,
  }
}
