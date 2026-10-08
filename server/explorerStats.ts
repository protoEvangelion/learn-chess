import { Chess } from 'chess.js'
import { getTurso } from './turso.js'
import { loadOpeningBook, positionKey, type BookLine } from './openingBook.js'
import {
  EXPLORER_MOVE_CAP,
  type ExplorerMove,
  type ExplorerOpening,
  type ExplorerPosition,
  type RatingBandId,
} from '../src/lib/lichessExplorer.js'

const SPEEDS = ['blitz', 'rapid', 'classical'] as const

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

/** Longest opening whose moves are a prefix of `uci`. */
function openingFor(index: NameIndex, uci: readonly string[]): ExplorerOpening | null {
  for (let length = uci.length; length >= 1; length -= 1) {
    const hit = index.get(uci.slice(0, length).join(','))
    if (hit) return hit
  }
  return null
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
  const bandPlace = ratings.map(() => '?').join(', ')
  const speedPlace = SPEEDS.map(() => '?').join(', ')
  const args = [key, ...ratings, ...SPEEDS]
  const db = getTurso()
  let moveRows: { uci: unknown; san: unknown; white: unknown; draws: unknown; black: unknown }[]
  let totals: { white: unknown; draws: unknown; black: unknown } | undefined
  let bookLines: BookLine[]
  try {
    const [movesResult, positionResult, book] = await Promise.all([
      db.execute({
        sql: `
          SELECT uci, san,
                 SUM(white) AS white,
                 SUM(draws) AS draws,
                 SUM(black) AS black
          FROM explorer_move
          WHERE position = ?
            AND rating_band IN (${bandPlace})
            AND speed IN (${speedPlace})
          GROUP BY uci, san
        `,
        args,
      }),
      db.execute({
        sql: `
          SELECT SUM(white) AS white,
                 SUM(draws) AS draws,
                 SUM(black) AS black
          FROM explorer_position
          WHERE position = ?
            AND rating_band IN (${bandPlace})
            AND speed IN (${speedPlace})
        `,
        args,
      }),
      loadOpeningBook(),
    ])
    moveRows = movesResult.rows as unknown as typeof moveRows
    totals = positionResult.rows[0] as unknown as typeof totals
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
        opening: openingFor(names, [...uciPath, uci]),
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
