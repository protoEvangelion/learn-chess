import { Chess, type Move as ChessMove } from 'chess.js'
import { copyBoard, createBoard, type Board } from '@logic/board'
import type { Color, MoveTypes, Piece } from '@logic/pieces'
import { getTile } from '@logic/pieces'
import type { GameOver } from '@/components/Board'
import {
  fenToGame,
  squareToPosition,
  boardToFen,
  START_FEN,
} from '@/lib/fenBridge'
import type { HistoryItem } from '@/state/game'

export type ImportedGame = {
  history: HistoryItem[]
  finalBoard: Board
  /** Side to move after the last ply (or at terminal position). */
  turn: Color
  playerColor: Color
  gameOver: GameOver | null
  finalFen: string
  whiteName: string | null
  blackName: string | null
  result: string | null
}

export type ParsePgnOptions = {
  /** Fallback when no chess.com username match. Default white. */
  preferColor?: Color
  /** If set and matches White/Black header, that side becomes the player. */
  chessComUsername?: string | null
}

const CHESSCOM_GAME_RE =
  /(?:https?:\/\/)?(?:www\.)?chess\.com\/game\/(live|daily)\/(\d+)/i

export function isChessComGameUrl(raw: string): boolean {
  return CHESSCOM_GAME_RE.test(raw.trim())
}

export function parseChessComGameUrl(
  raw: string,
): { type: 'live' | 'daily'; id: string } | null {
  const m = raw.trim().match(CHESSCOM_GAME_RE)
  if (!m) return null
  return { type: m[1].toLowerCase() as 'live' | 'daily', id: m[2] }
}

/** True if the paste looks like PGN rather than a bare URL. */
export function looksLikePgn(raw: string): boolean {
  const t = raw.trim()
  if (!t || isChessComGameUrl(t)) return false
  return (
    t.includes('[Event') ||
    t.includes('[White') ||
    /^\s*1\./.test(t) ||
    /\b1-0\b|\b0-1\b|\b1\/2-1\/2\b|\*/.test(t)
  )
}

function moveTypeFromFlags(move: ChessMove): MoveTypes {
  if (move.flags.includes('e')) return 'captureEnPassant'
  if (/[kq]/i.test(move.flags)) return 'castling'
  if (move.captured || move.flags.includes('c')) return 'capture'
  return 'valid'
}

function resolvePlayerColor(
  whiteName: string | null,
  blackName: string | null,
  opts?: ParsePgnOptions,
): Color {
  const user = opts?.chessComUsername?.trim().toLowerCase()
  if (user) {
    if (whiteName?.toLowerCase() === user) return 'white'
    if (blackName?.toLowerCase() === user) return 'black'
  }
  return opts?.preferColor ?? 'white'
}

function gameOverFromChess(
  chess: Chess,
  resultHeader: string | null,
): GameOver | null {
  if (chess.isCheckmate()) {
    // Side to move is mated → opponent won
    const winner: Color = chess.turn() === 'w' ? 'black' : 'white'
    return { type: 'checkmate', winner }
  }
  if (chess.isStalemate() || chess.isDraw()) {
    return { type: 'stalemate', winner: 'white' }
  }

  const result = (resultHeader ?? chess.header().Result ?? '').trim()
  if (result === '1-0') return { type: 'resign', winner: 'white' }
  if (result === '0-1') return { type: 'resign', winner: 'black' }
  if (result === '1/2-1/2') return { type: 'draw', winner: null }
  return null
}

/**
 * Parse a PGN into this app's HistoryItem timeline.
 * Each HistoryItem.board is the position *before* that ply (matches live play).
 */
export function parsePgnToImportedGame(
  pgn: string,
  opts?: ParsePgnOptions,
): ImportedGame {
  const trimmed = pgn.trim()
  if (!trimmed) throw new Error('Empty PGN')

  const chess = new Chess()
  try {
    chess.loadPgn(trimmed, { strict: false })
  } catch (err) {
    throw new Error(
      err instanceof Error ? `Invalid PGN: ${err.message}` : 'Invalid PGN',
    )
  }

  const header = chess.header()
  const whiteName = header.White?.trim() || null
  const blackName = header.Black?.trim() || null
  const result = header.Result?.trim() || null
  const playerColor = resolvePlayerColor(whiteName, blackName, opts)

  const verbose = chess.history({ verbose: true })
  chess.reset()
  const fenHeader = header.FEN
  if (fenHeader) {
    try {
      chess.load(fenHeader)
    } catch {
      chess.reset()
    }
  }

  const history: HistoryItem[] = []

  for (const move of verbose) {
    const beforeFen = chess.fen()
    const before = fenToGame(beforeFen)
    if (!before) {
      throw new Error(`Could not parse position before ${move.san}`)
    }

    const from = squareToPosition(move.from)
    const to = squareToPosition(move.to)
    const pieceTile = getTile(before.board, from)
    const piece = pieceTile?.piece
    if (!piece) {
      throw new Error(`No piece on ${move.from} for ${move.san}`)
    }

    let capture: Piece | null = null
    if (move.captured) {
      if (move.flags.includes('e')) {
        const epY = piece.color === 'white' ? to.y + 1 : to.y - 1
        capture = getTile(before.board, { x: to.x, y: epY })?.piece ?? null
      } else {
        capture = getTile(before.board, to)?.piece ?? null
      }
    }

    history.push({
      board: copyBoard(before.board),
      from,
      to,
      capture,
      type: moveTypeFromFlags(move),
      steps: { x: to.x - from.x, y: to.y - from.y },
      piece: { ...piece },
    })

    const played = chess.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion,
    })
    if (!played) {
      throw new Error(`Illegal move in PGN: ${move.san}`)
    }
  }

  const finalFen = chess.fen()
  const finalParsed = fenToGame(finalFen)
  const finalBoard = finalParsed?.board ?? createBoard()
  const turn: Color = chess.turn() === 'b' ? 'black' : 'white'
  const gameOver = gameOverFromChess(chess, result)

  return {
    history,
    finalBoard,
    turn,
    playerColor,
    gameOver,
    finalFen: finalParsed
      ? boardToFen(finalBoard, turn, history)
      : finalFen || START_FEN,
    whiteName,
    blackName,
    result,
  }
}

/** Board / turn at scrub index (0 = start, history.length = final). */
export function positionAtPly(
  imported: Pick<ImportedGame, 'history' | 'finalBoard' | 'turn'>,
  scrubIndex: number,
): { board: Board; turn: Color } {
  const n = imported.history.length
  const i = Math.max(0, Math.min(scrubIndex, n))
  if (i >= n) {
    return { board: copyBoard(imported.finalBoard), turn: imported.turn }
  }
  const item = imported.history[i]
  return {
    board: copyBoard(item.board),
    turn: item.piece.color,
  }
}
