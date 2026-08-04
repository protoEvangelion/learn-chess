import type { Board, Position } from '@logic/board'
import type { Color, PieceType } from '@logic/pieces'
import { isKing } from '@logic/pieces/king'
import { isRook } from '@logic/pieces/rook'
import type { HistoryItem } from '@/state/game'

const TYPE_TO_FEN: Record<PieceType, string> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
}

/** Board x,y → algebraic. y=0 is rank 8. */
export function positionToSquare(pos: Position): string {
  return `${String.fromCharCode(97 + pos.x)}${8 - pos.y}`
}

export function squareToPosition(square: string): Position {
  const file = square.charCodeAt(0) - 97
  const rank = Number(square[1])
  return { x: file, y: 8 - rank }
}

export function boardToFen(
  board: Board,
  turn: Color,
  history: HistoryItem[],
): string {
  const rows: string[] = []
  for (let y = 0; y < 8; y++) {
    let empty = 0
    let row = ''
    for (let x = 0; x < 8; x++) {
      const piece = board[y][x].piece
      if (!piece) {
        empty += 1
        continue
      }
      if (empty) {
        row += String(empty)
        empty = 0
      }
      const letter = TYPE_TO_FEN[piece.type]
      row += piece.color === 'white' ? letter.toUpperCase() : letter
    }
    if (empty) row += String(empty)
    rows.push(row)
  }

  const castling = castlingRights(board)
  const ep = enPassantTarget(history)
  const fullmove = Math.floor(history.length / 2) + 1

  return `${rows.join('/')} ${turn === 'white' ? 'w' : 'b'} ${castling} ${ep} 0 ${fullmove}`
}

function castlingRights(board: Board): string {
  let rights = ''
  const wk = board[7][4].piece
  const bk = board[0][4].piece
  if (isKing(wk) && wk.color === 'white' && !wk.hasMoved) {
    const wrH = board[7][7].piece
    const wrA = board[7][0].piece
    if (isRook(wrH) && wrH.color === 'white' && !wrH.hasMoved) rights += 'K'
    if (isRook(wrA) && wrA.color === 'white' && !wrA.hasMoved) rights += 'Q'
  }
  if (isKing(bk) && bk.color === 'black' && !bk.hasMoved) {
    const brH = board[0][7].piece
    const brA = board[0][0].piece
    if (isRook(brH) && brH.color === 'black' && !brH.hasMoved) rights += 'k'
    if (isRook(brA) && brA.color === 'black' && !brA.hasMoved) rights += 'q'
  }
  return rights || '-'
}

function enPassantTarget(history: HistoryItem[]): string {
  const last = history[history.length - 1]
  if (!last || last.piece.type !== 'pawn' || Math.abs(last.steps.y) !== 2) {
    return '-'
  }
  const y = (last.from.y + last.to.y) / 2
  return positionToSquare({ x: last.to.x, y })
}
