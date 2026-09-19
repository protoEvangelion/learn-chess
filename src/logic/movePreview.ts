import type { Board, Position } from './board'
import { checkIfPositionsMatch, copyBoard } from './board'
import type { Color, Move, Piece, PieceType } from './pieces'
import {
  getPiece,
  getTile,
  isKingInCheck,
  movesForPiece,
  oppositeColor,
} from './pieces'
import { isKing } from './pieces/king'
import { isPawn } from './pieces/pawn'
import { isRook } from './pieces/rook'

export type CaptureTradeLabel = 'free' | 'even' | 'winning' | 'losing'

export type MovePreview = {
  destinationThreatened: boolean
  destinationGuarded: boolean
  leavesHanging: boolean
  captureTrade: null | {
    label: CaptureTradeLabel
    net: number
  }
  givesCheck: boolean
}

export type PreviewIcon =
  | 'threatened'
  | 'hanging'
  | 'guarded'
  | 'free'
  | 'winning'
  | 'even'
  | 'losing'
  | 'check'

const PIECE_VALUE: Record<PieceType, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 100,
}

export function positionKey(pos: Position): string {
  return `${pos.x},${pos.y}`
}

function pieceValue(piece: Piece | null | undefined): number {
  if (!piece) return 0
  return PIECE_VALUE[piece.type] ?? 0
}

function isLegalPreviewMove(move: Move): boolean {
  return (
    move.type === 'valid' ||
    move.type === 'capture' ||
    move.type === 'captureEnPassant' ||
    move.type === 'castling'
  )
}

/**
 * Squares occupied by pieces of `byColor` that attack / control `square`.
 * Friendly pieces on `square` are treated as capturable so defenders count
 * (movesForPiece never emits captures onto same-color pieces).
 */
export function attackersOf(
  board: Board,
  square: Position,
  byColor: Color,
): Position[] {
  const probe = copyBoard(board)
  const target = getTile(probe, square)
  if (target?.piece?.color === byColor) {
    target.piece = {
      ...target.piece,
      color: oppositeColor(byColor),
    }
  }

  const out: Position[] = []
  for (const tile of probe.flat()) {
    if (tile.piece?.color !== byColor) continue
    if (checkIfPositionsMatch(tile.position, square)) continue
    const moves = movesForPiece({
      piece: tile.piece,
      board: probe,
      propagateDetectCheck: false,
    })
    if (
      moves.some(
        (m) =>
          checkIfPositionsMatch(m.newPosition, square) &&
          (m.type === 'capture' ||
            m.type === 'captureKing' ||
            m.type === 'captureEnPassant' ||
            m.type === 'valid'),
      )
    ) {
      out.push(tile.position)
    }
  }
  return out
}

export function applyMoveOnCopy(board: Board, move: Move): Board {
  const newBoard = copyBoard(board)
  const from = getTile(newBoard, move.piece.position)
  const to = getTile(newBoard, move.newPosition)
  if (!from || !to || !from.piece) return newBoard

  let mover = { ...from.piece } as Piece & { hasMoved?: boolean }
  if (isPawn(mover) || isKing(mover) || isRook(mover)) {
    mover = { ...mover, hasMoved: true }
  }

  if (move.type === 'captureEnPassant' && move.capture) {
    const capTile = getTile(newBoard, move.capture.position)
    if (capTile) capTile.piece = null
  }

  if (move.castling) {
    const { rook, rookNewPosition } = move.castling
    const rookFrom = getTile(newBoard, rook.position)
    const rookTo = getTile(newBoard, rookNewPosition)
    if (rookFrom?.piece && rookTo) {
      rookTo.piece = {
        ...rookFrom.piece,
        hasMoved: true,
        position: rookTo.position,
      }
      rookFrom.piece = null
    }
  }

  to.piece = { ...mover, position: to.position }
  from.piece = null
  return newBoard
}

function isUnprotectedHanging(
  board: Board,
  pos: Position,
  color: Color,
): boolean {
  const piece = getPiece(board, pos)
  if (!piece || piece.color !== color || piece.type === 'king') return false
  if (attackersOf(board, pos, oppositeColor(color)).length === 0) return false
  return attackersOf(board, pos, color).length === 0
}

function captureTradeFor(
  after: Board,
  move: Move,
): MovePreview['captureTrade'] {
  if (move.type !== 'capture' && move.type !== 'captureEnPassant') return null
  const victim = move.capture
  if (!victim) return null

  const opp = oppositeColor(move.piece.color)
  const recapturers = attackersOf(after, move.newPosition, opp)
  const gain = pieceValue(victim)

  if (recapturers.length === 0) {
    return { label: 'free', net: gain }
  }

  const net = gain - pieceValue(move.piece)
  if (net > 0) return { label: 'winning', net }
  if (net < 0) return { label: 'losing', net }
  return { label: 'even', net: 0 }
}

export function previewMove(board: Board, move: Move): MovePreview {
  const after = applyMoveOnCopy(board, move)
  const color = move.piece.color
  const opp = oppositeColor(color)
  const dest = move.newPosition

  const destinationThreatened = attackersOf(after, dest, opp).length > 0
  const destinationGuarded = attackersOf(after, dest, color).length > 0
  const givesCheck = isKingInCheck(after, opp)

  let leavesHanging = false
  for (const tile of after.flat()) {
    if (!tile.piece || tile.piece.color !== color) continue
    if (checkIfPositionsMatch(tile.position, dest)) continue
    if (
      isUnprotectedHanging(after, tile.position, color) &&
      !isUnprotectedHanging(board, tile.position, color)
    ) {
      leavesHanging = true
      break
    }
  }

  return {
    destinationThreatened,
    destinationGuarded,
    leavesHanging,
    captureTrade: captureTradeFor(after, move),
    givesCheck,
  }
}

export function previewByDestination(
  board: Board,
  moves: Move[],
): Map<string, MovePreview> {
  const map = new Map<string, MovePreview>()
  for (const move of moves) {
    if (!isLegalPreviewMove(move)) continue
    map.set(positionKey(move.newPosition), previewMove(board, move))
  }
  return map
}

/** Squares of `color` pieces currently attackable by the opponent. */
export function threatenedPieceKeys(board: Board, color: Color): Set<string> {
  const opp = oppositeColor(color)
  const keys = new Set<string>()
  for (const tile of board.flat()) {
    if (!tile.piece || tile.piece.color !== color) continue
    if (attackersOf(board, tile.position, opp).length > 0) {
      keys.add(positionKey(tile.position))
    }
  }
  return keys
}

/** Squares of `color` pieces defended by at least one friendly attacker. */
export function protectedPieceKeys(board: Board, color: Color): Set<string> {
  const keys = new Set<string>()
  for (const tile of board.flat()) {
    if (!tile.piece || tile.piece.color !== color) continue
    if (attackersOf(board, tile.position, color).length > 0) {
      keys.add(positionKey(tile.position))
    }
  }
  return keys
}

export type PieceSafety = 'hanging' | 'contested' | 'loose' | 'safe'

/** Per-square safety for `color` pieces on this board. */
export function pieceSafetyMap(
  board: Board,
  color: Color,
): Map<string, PieceSafety> {
  const opp = oppositeColor(color)
  const map = new Map<string, PieceSafety>()
  for (const tile of board.flat()) {
    if (!tile.piece || tile.piece.color !== color) continue
    const threatened = attackersOf(board, tile.position, opp).length > 0
    const protectedBy = attackersOf(board, tile.position, color).length > 0
    const key = positionKey(tile.position)
    if (threatened && protectedBy) map.set(key, 'contested')
    else if (threatened) map.set(key, 'hanging')
    else if (protectedBy) map.set(key, 'safe')
    else map.set(key, 'loose')
  }
  return map
}

export const PIECE_SAFETY_COLOR: Record<PieceSafety, string> = {
  hanging: '#ff4040',
  contested: '#ff4fd8',
  loose: '#f0a020',
  safe: '#4d9fff',
}

export function tradeMarkerLabel(trade: {
  label: CaptureTradeLabel
  net: number
}): string {
  if (trade.label === 'even') return '='
  if (trade.label === 'losing') return String(trade.net)
  return `+${trade.net}`
}

export function tradeMarkerColor(label: CaptureTradeLabel): string {
  if (label === 'free') return '#2dd4bf'
  if (label === 'winning') return '#4ade80'
  if (label === 'even') return '#e4e4e7'
  return '#ff4040'
}

/** Primary wash hex for a destination (severity priority). */
export function washColorForPreview(p: MovePreview): string {
  const trade = p.captureTrade?.label
  if (trade === 'losing' || p.destinationThreatened) return '#ff4040'
  if (p.leavesHanging) return '#f0a020'
  if (trade === 'winning') return '#4ade80'
  if (trade === 'free') return '#2dd4bf'
  if (trade === 'even') return '#c8c8c8'
  if (p.destinationGuarded) return '#6ec8d4'
  return '#5eb0ff'
}

export function iconsForPreview(p: MovePreview): PreviewIcon[] {
  const icons: PreviewIcon[] = []
  if (p.captureTrade?.label === 'losing') icons.push('losing')
  else if (p.destinationThreatened) icons.push('threatened')
  if (p.leavesHanging) icons.push('hanging')
  if (p.destinationGuarded) icons.push('guarded')
  if (p.captureTrade?.label === 'free') icons.push('free')
  if (p.captureTrade?.label === 'winning') icons.push('winning')
  if (p.captureTrade?.label === 'even') icons.push('even')
  if (p.givesCheck) icons.push('check')
  return icons
}

export const PREVIEW_ICON_GLYPH: Record<PreviewIcon, string> = {
  threatened: '!',
  hanging: '⤵',
  guarded: '🛡',
  free: '⊕',
  winning: '↑',
  even: '↔',
  losing: '↓',
  check: '♔+',
}

export function tooltipLinesForPreview(p: MovePreview): string[] {
  const lines: string[] = []
  if (p.destinationThreatened) lines.push('Landing threatened')
  else lines.push('Landing safe')
  if (p.destinationGuarded) lines.push('Guarded')
  else if (!p.destinationThreatened) lines.push('Unguarded')
  if (p.leavesHanging) lines.push('Leaves a piece hanging')
  if (p.captureTrade) {
    const n = p.captureTrade.net
    const signed = n > 0 ? `+${n}` : `${n}`
    if (p.captureTrade.label === 'free') lines.push(`Free take (${signed})`)
    else if (p.captureTrade.label === 'winning')
      lines.push(`Winning trade (${signed})`)
    else if (p.captureTrade.label === 'even') lines.push('Even trade')
    else lines.push(`Losing trade (${signed})`)
  }
  if (p.givesCheck) lines.push('Gives check')
  return lines
}
