import { Chess, type Move as ChessMove } from 'chess.js'
import { copyBoard, createBoard, type Board } from '@logic/board'
import type { Color, MoveTypes, Piece } from '@logic/pieces'
import { getTile } from '@logic/pieces'
import { isPawn } from '@logic/pieces/pawn'
import type { GameOver } from '@/components/Board'
import {
  fenToGame,
  positionToSquare,
  squareToPosition,
  boardToFen,
  START_FEN,
} from '@/lib/fenBridge'
import type { HistoryItem } from '@/state/game'
import {
  readPlayerColorHeader,
  sideForUsername,
  type PlayerSide,
} from '@/lib/playerSide'

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
  whiteElo: number | null
  blackElo: number | null
  result: string | null
  /** Compact PGN (no clock comments) for the URL. */
  pgn: string
}

export type ParsePgnOptions = {
  /**
   * Side already known from the chess.com account (archive white/black
   * username) or a previous save. Wins over name matching.
   */
  playerColor?: PlayerSide
  /** Last resort when the game does not say who the human was. */
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

function headerValue(pgn: string, key: string): string | null {
  const match = pgn.match(new RegExp(`\\[${key}\\s+"([^"]*)"\\]`, 'i'))
  const value = match?.[1]?.trim()
  if (!value || value === '?') return null
  return value
}

function namedHeader(
  fromChess: string | null | undefined,
  raw: string | null,
): string | null {
  const value = fromChess?.trim()
  if (value && value !== '?') return value
  return raw
}

/**
 * Who the human is in this game.
 * Saved header and the account side come first. A username match is next.
 * White is only the fallback when the game never says — not a guess that
 * overrides Black.
 */
function resolvePlayerColor(
  pgn: string,
  whiteName: string | null,
  blackName: string | null,
  opts?: ParsePgnOptions,
): Color {
  if (opts?.playerColor === 'white' || opts?.playerColor === 'black') {
    return opts.playerColor
  }
  const saved = readPlayerColorHeader(pgn)
  if (saved) return saved
  const matched =
    sideForUsername(whiteName, blackName, opts?.chessComUsername) ??
    sideForUsername(
      headerValue(pgn, 'WhiteUrl'),
      headerValue(pgn, 'BlackUrl'),
      opts?.chessComUsername,
    )
  if (matched) return matched
  return opts?.preferColor ?? 'white'
}

const RESULT_TOKEN = /^(1-0|0-1|1\/2-1\/2|\*)$/

function pgnTokens(pgn: string): string[] {
  const noComments = pgn.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ')
  const noHeaders = noComments.replace(/\[[^\]]*\]/g, ' ')
  return noHeaders
    .split(/\s+/)
    .filter((token) => token && !/^\d+\.+$/.test(token) && !RESULT_TOKEN.test(token))
}

/**
 * Load a PGN. If a move is illegal or out of order, keep the moves that
 * already fit instead of throwing — chess.js `move()` throws `Invalid move`.
 */
function loadPgnResilient(pgn: string): Chess {
  const chess = new Chess()
  try {
    chess.loadPgn(pgn, { strict: false })
    return chess
  } catch {
    // Replay SAN until the first move that does not fit.
  }

  const fallback = new Chess()
  const fenHeader = pgn.match(/\[FEN\s+"([^"]+)"\]/i)?.[1]
  if (fenHeader) {
    try {
      fallback.load(fenHeader)
    } catch {
      fallback.reset()
    }
  }
  for (const san of pgnTokens(pgn)) {
    try {
      fallback.move(san)
    } catch {
      break
    }
  }
  const white = pgn.match(/\[White\s+"([^"]*)"\]/i)?.[1]
  const black = pgn.match(/\[Black\s+"([^"]*)"\]/i)?.[1]
  const result = pgn.match(/\[Result\s+"([^"]*)"\]/i)?.[1]
  if (white) fallback.setHeader('White', white)
  if (black) fallback.setHeader('Black', black)
  if (result) fallback.setHeader('Result', result)
  if (fenHeader) {
    fallback.setHeader('SetUp', '1')
    fallback.setHeader('FEN', fenHeader)
  }
  if (fallback.history().length === 0 && !fenHeader) {
    throw new Error('Invalid PGN')
  }
  return fallback
}

/** SAN list for the moves actually on the board. Check and mate marks are kept. */
export function historyToSans(history: HistoryItem[]): string[] {
  if (history.length === 0) return []
  const chess = new Chess()
  const sans: string[] = []
  for (const item of history) {
    const from = positionToSquare(item.from)
    const to = positionToSquare(item.to)
    const promotion =
      isPawn(item.piece) && (item.to.y === 0 || item.to.y === 7) ? 'q' : undefined
    try {
      const played = chess.move({ from, to, promotion })
      if (!played) break
      sans.push(played.san)
    } catch {
      break
    }
  }
  return sans
}

/** PGN without clock comments, suitable for a query param. */
export function historyToPgn(history: HistoryItem[]): string {
  const sans = historyToSans(history)
  if (sans.length === 0) return ''
  const chess = new Chess()
  for (const san of sans) {
    try {
      if (!chess.move(san)) break
    } catch {
      break
    }
  }
  if (chess.history().length === 0) return ''
  return stripPlaceholderHeaders(chess.pgn({ maxWidth: 0 }))
}

function readElo(value: string | null | undefined): number | null {
  if (!value) return null
  const elo = Number(value)
  if (!Number.isFinite(elo) || elo <= 0) return null
  return Math.round(elo)
}

function stripPlaceholderHeaders(pgn: string): string {
  return pgn
    .replace(/\[(?:Event|Site|Round) "\?"\]\r?\n/g, '')
    .replace(/\[Date "\?{4}(?:\.\?{2}){2}"\]\r?\n/g, '')
    .replace(/^\n+/, '')
}

function pgnWithNames(
  history: HistoryItem[],
  whiteName: string | null,
  blackName: string | null,
  result: string | null,
  playerColor: Color,
): string {
  const body = historyToPgn(history)
  if (!body) return ''
  const chess = new Chess()
  try {
    chess.loadPgn(body, { strict: false })
  } catch {
    return body
  }
  if (whiteName) chess.setHeader('White', whiteName)
  if (blackName) chess.setHeader('Black', blackName)
  if (result) chess.setHeader('Result', result)
  // Survives the URL. A reload reads this instead of assuming White.
  chess.setHeader('PlayerColor', playerColor)
  return stripPlaceholderHeaders(chess.pgn({ maxWidth: 0 }))
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

  let chess: Chess
  try {
    chess = loadPgnResilient(trimmed)
  } catch (err) {
    throw new Error(
      err instanceof Error ? `Invalid PGN: ${err.message}` : 'Invalid PGN',
    )
  }

  const header = chess.header()
  const whiteName = namedHeader(header.White, headerValue(trimmed, 'White'))
  const blackName = namedHeader(header.Black, headerValue(trimmed, 'Black'))
  const whiteElo = readElo(
    header.WhiteElo ?? headerValue(trimmed, 'WhiteElo') ?? undefined,
  )
  const blackElo = readElo(
    header.BlackElo ?? headerValue(trimmed, 'BlackElo') ?? undefined,
  )
  const result = header.Result?.trim() || headerValue(trimmed, 'Result')
  const playerColor = resolvePlayerColor(trimmed, whiteName, blackName, opts)

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
    if (!before) break

    const from = squareToPosition(move.from)
    const to = squareToPosition(move.to)
    const pieceTile = getTile(before.board, from)
    const piece = pieceTile?.piece
    if (!piece) break

    let capture: Piece | null = null
    if (move.captured) {
      if (move.flags.includes('e')) {
        const epY = piece.color === 'white' ? to.y + 1 : to.y - 1
        capture = getTile(before.board, { x: to.x, y: epY })?.piece ?? null
      } else {
        capture = getTile(before.board, to)?.piece ?? null
      }
    }

    let played: ChessMove | null = null
    try {
      played = chess.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion,
      })
    } catch {
      played = null
    }
    if (!played) break

    history.push({
      board: copyBoard(before.board),
      from,
      to,
      capture,
      type: moveTypeFromFlags(move),
      steps: { x: to.x - from.x, y: to.y - from.y },
      piece: { ...piece },
    })
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
    whiteElo,
    blackElo,
    result,
    pgn: pgnWithNames(history, whiteName, blackName, result, playerColor) || trimmed,
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
