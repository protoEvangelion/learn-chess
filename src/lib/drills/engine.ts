import { Chess } from 'chess.js'
import type { Board } from '@logic/board'
import type { Color, Move } from '@logic/pieces'
import { getTile, movesForPiece } from '@logic/pieces'
import { boardToFen, positionToSquare, squareToPosition } from '@/lib/fenBridge'
import type { HistoryItem } from '@/state/game'
import type { DrillLine } from '@/lib/drills/types'

/** White plies are even indices 0,2,4… in the moves array. */
export function isPlayerPly(plyIndex: number) {
  return plyIndex % 2 === 0
}

export function expectedSan(line: DrillLine, plyIndex: number) {
  return line.moves[plyIndex]?.san ?? null
}

export function hintForPly(line: DrillLine, plyIndex: number) {
  return line.moves[plyIndex]?.hint ?? 'Play the natural developing move.'
}

/**
 * Study this drill line on Lichess analysis with the moves loaded.
 * (Opening search `?q=` does not resolve move paths — it only text-searches names.)
 * From analysis, “Opening explorer” shows game stats for the position.
 */
export function drillLineSourceUrl(line: DrillLine): string {
  // Underscore-separated SAN; encode so Bb4+ → Bb4%2B
  const path = line.moves.map((m) => m.san).join('_')
  return `https://lichess.org/analysis/pgn/${encodeURIComponent(path)}`
}

/** Does this legal Move match the expected SAN for the current drill ply? */
export function moveMatchesSan(
  board: Board,
  history: HistoryItem[],
  turn: Color,
  move: Move,
  expected: string,
): boolean {
  const fen = boardToFen(board, turn, history)
  const chess = new Chess(fen)
  const from = positionToSquare(move.piece.position)
  const to = positionToSquare(move.newPosition)
  const promotion =
    move.piece.type === 'pawn' && (to[1] === '8' || to[1] === '1')
      ? 'q'
      : undefined
  try {
    const played = chess.move({ from, to, promotion })
    if (!played) return false
    const norm = (s: string) => s.replace(/[+#]/g, '')
    return norm(played.san) === norm(expected)
  } catch {
    return false
  }
}

/** Chessreps-style coach phrase for the expected book move. */
export function recommendPhrase(san: string): string {
  const clean = san.replace(/[+#]/g, '')
  if (clean === 'O-O') return 'castling kingside'
  if (clean === 'O-O-O') return 'castling queenside'
  if (/^[a-h][1-8]$/.test(clean)) return `pawn to ${clean}`
  if (/^[a-h]x[a-h][1-8]/.test(clean)) return `pawn takes on ${clean.slice(-2)}`
  const names: Record<string, string> = {
    N: 'knight',
    B: 'bishop',
    R: 'rook',
    Q: 'queen',
    K: 'king',
  }
  const piece = names[clean[0]]
  if (piece) {
    const dest = clean.slice(-2)
    return clean.includes('x') ? `${piece} takes on ${dest}` : `${piece} to ${dest}`
  }
  return clean
}

/** Did this history entry play the expected SAN? */
export function historyItemMatchesSan(
  item: HistoryItem,
  historyBefore: HistoryItem[],
  expected: string,
): boolean {
  const fen = boardToFen(item.board, item.piece.color, historyBefore)
  const chess = new Chess(fen)
  const from = positionToSquare(item.from)
  const to = positionToSquare(item.to)
  const promotion =
    item.piece.type === 'pawn' && (to[1] === '8' || to[1] === '1')
      ? 'q'
      : undefined
  try {
    const played = chess.move({ from, to, promotion })
    if (!played) return false
    const norm = (s: string) => s.replace(/[+#]/g, '')
    return norm(played.san) === norm(expected)
  } catch {
    return false
  }
}

/** Convert next SAN into a Board Move for auto-play (Black). */
export function sanToBoardMove(
  board: Board,
  history: HistoryItem[],
  turn: Color,
  san: string,
): Move | null {
  const fen = boardToFen(board, turn, history)
  const chess = new Chess(fen)
  let played
  try {
    played = chess.move(san)
  } catch {
    return null
  }
  if (!played) return null
  const from = squareToPosition(played.from)
  const pieceTile = getTile(board, from)
  const piece = pieceTile?.piece
  if (!piece || piece.color !== turn) return null
  const legal = movesForPiece({
    piece,
    board,
    propagateDetectCheck: true,
  })
  const to = squareToPosition(played.to)
  return (
    legal.find(
      (m) => m.newPosition.x === to.x && m.newPosition.y === to.y,
    ) ?? null
  )
}

/** From/to for the expected SAN (hint arrows). */
export function squaresForSan(
  board: Board,
  history: HistoryItem[],
  turn: Color,
  san: string,
): {
  from: ReturnType<typeof squareToPosition>
  to: ReturnType<typeof squareToPosition>
  label: string
} | null {
  const fen = boardToFen(board, turn, history)
  try {
    const probe = new Chess(fen)
    const played = probe.move(san)
    if (!played) return null
    return {
      from: squareToPosition(played.from),
      to: squareToPosition(played.to),
      label: `${played.from}–${played.to}`,
    }
  } catch {
    return null
  }
}
