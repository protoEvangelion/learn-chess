import type { Board, Position } from '@logic/board'
import { createTile } from '@logic/board'
import type { Color, PieceType } from '@logic/pieces'
import { isKing } from '@logic/pieces/king'
import { isPawn } from '@logic/pieces/pawn'
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

const FEN_TO_TYPE: Record<string, PieceType> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}

export const START_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

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

export type FenGame = {
  board: Board
  turn: Color
  history: HistoryItem[]
}

/** Parse a FEN into board + turn + synthetic history (for en passant). */
export function fenToGame(fen: string): FenGame | null {
  const parts = fen.trim().split(/\s+/)
  if (parts.length < 4) return null
  const [placement, turnPart, castling, ep] = parts
  if (!placement || (turnPart !== 'w' && turnPart !== 'b')) return null

  const ranks = placement.split('/')
  if (ranks.length !== 8) return null

  const ids: Record<string, number> = {}
  const board: Board = []

  for (let y = 0; y < 8; y++) {
    const rank = ranks[y]
    if (!rank) return null
    const row = []
    let x = 0
    for (const ch of rank) {
      if (x > 8) return null
      if (ch >= '1' && ch <= '8') {
        const n = Number(ch)
        for (let i = 0; i < n; i++) {
          row.push(createTile({ x, y }))
          x += 1
        }
        continue
      }
      const type = FEN_TO_TYPE[ch.toLowerCase()]
      if (!type || x >= 8) return null
      const color: Color = ch === ch.toUpperCase() ? 'white' : 'black'
      const key = `${color}-${type}`
      ids[key] = (ids[key] ?? 0) + 1
      row.push(createTile({ x, y }, { color, id: ids[key], type }))
      x += 1
    }
    if (x !== 8) return null
    board.push(row)
  }

  applyCastlingRights(board, castling === '-' ? '' : castling)
  applyPawnMovedFlags(board)

  const turn: Color = turnPart === 'b' ? 'black' : 'white'
  const history = syntheticEpHistory(board, ep)

  return { board, turn, history }
}

function applyPawnMovedFlags(board: Board) {
  for (const row of board) {
    for (const tile of row) {
      const piece = tile.piece
      if (!isPawn(piece)) continue
      const startY = piece.color === 'white' ? 6 : 1
      if (piece.position.y !== startY) piece.hasMoved = true
    }
  }
}

function applyCastlingRights(board: Board, rights: string) {
  const wk = board[7][4].piece
  const bk = board[0][4].piece
  const wrH = board[7][7].piece
  const wrA = board[7][0].piece
  const brH = board[0][7].piece
  const brA = board[0][0].piece

  if (isKing(wk) && wk.color === 'white') {
    if (!rights.includes('K') && !rights.includes('Q')) wk.hasMoved = true
    else {
      if (!rights.includes('K') && isRook(wrH)) wrH.hasMoved = true
      if (!rights.includes('Q') && isRook(wrA)) wrA.hasMoved = true
    }
  }
  if (isKing(bk) && bk.color === 'black') {
    if (!rights.includes('k') && !rights.includes('q')) bk.hasMoved = true
    else {
      if (!rights.includes('k') && isRook(brH)) brH.hasMoved = true
      if (!rights.includes('q') && isRook(brA)) brA.hasMoved = true
    }
  }
}

function syntheticEpHistory(board: Board, ep: string): HistoryItem[] {
  if (!ep || ep === '-') return []
  const epPos = squareToPosition(ep)
  const isWhitePush = ep[1] === '3'
  const isBlackPush = ep[1] === '6'
  if (!isWhitePush && !isBlackPush) return []

  const to: Position = isWhitePush
    ? { x: epPos.x, y: 4 }
    : { x: epPos.x, y: 3 }
  const from: Position = isWhitePush
    ? { x: epPos.x, y: 6 }
    : { x: epPos.x, y: 1 }
  const piece = board[to.y][to.x].piece
  if (!isPawn(piece)) return []

  return [
    {
      board,
      from,
      to,
      capture: null,
      type: 'valid',
      steps: { x: 0, y: isWhitePush ? -2 : 2 },
      piece,
    },
  ]
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

export function readFenFromUrl(search = window.location.search): string | null {
  const fen = new URLSearchParams(search).get('fen')
  if (!fen?.trim()) return null
  return fen.trim()
}

export function readGameIdFromUrl(
  search = window.location.search,
): string | null {
  const id = new URLSearchParams(search).get('gameId')
  if (!id?.trim()) return null
  return id.trim()
}

/** Which drawer is open — at most one. */
export type PanelId = 'settings' | 'game' | 'analysis' | 'drill'

/** Opening drill pack id in the URL (e.g. italian). */
export type OpeningId = 'italian'

export function readPanelFromUrl(
  search = window.location.search,
): PanelId | null {
  const p = new URLSearchParams(search).get('panel')
  // Legacy import panel folded into analysis; coach → game (Moves|Coach tabs).
  if (p === 'import') return 'analysis'
  if (p === 'coach') return 'game'
  if (p === 'settings' || p === 'game' || p === 'analysis' || p === 'drill') {
    return p
  }
  return null
}

export function readOpeningFromUrl(
  search = window.location.search,
): OpeningId | null {
  const o = new URLSearchParams(search).get('opening')?.trim().toLowerCase()
  if (o === 'italian') return o
  return null
}

/** Drill line id (e.g. rook-bait). */
export function readLineFromUrl(
  search = window.location.search,
): string | null {
  const line = new URLSearchParams(search).get('line')?.trim()
  if (!line) return null
  return line
}

export type UrlGameState = {
  fen: string
  gameId: string
  idx: number
  panel?: PanelId | null
  opening?: OpeningId | null
  line?: string | null
}

/**
 * URL param policy by panel:
 *
 * | panel     | gameId                                      | opening/line |
 * |-----------|---------------------------------------------|--------------|
 * | drill     | never (shareable practice)                  | yes when set |
 * | game      | session id for Cursor chat resume           | never        |
 * | analysis  | session id                                  | never        |
 * | settings  | leave alone — panel switch must not inject  | never        |
 * | (none)    | session id for free-play resume             | never        |
 *
 * Panel switches only change `panel` (+ clear drill keys when leaving drill).
 * They read gameId from the current URL only — never from React memory —
 * so drill → settings cannot suddenly grow a gameId.
 */
export function resolveGameIdForUrl(
  panel: PanelId | null,
  requested: string,
): string {
  if (panel === 'drill') return ''
  return requested
}

function normalizeDrillKeys(
  panel: PanelId | null,
  opening: OpeningId | null,
  line: string | null,
): { opening: OpeningId | null; line: string | null } {
  if (panel !== 'drill') return { opening: null, line: null }
  return { opening, line }
}

function toLocation(
  fen: string,
  gameId: string,
  panel: PanelId | null,
  opening: OpeningId | null,
  line: string | null,
): string {
  const url = new URL(window.location.href)
  if (fen === START_FEN) url.searchParams.delete('fen')
  else url.searchParams.set('fen', fen)

  if (gameId) url.searchParams.set('gameId', gameId)
  else url.searchParams.delete('gameId')

  if (panel) url.searchParams.set('panel', panel)
  else url.searchParams.delete('panel')

  const drill = normalizeDrillKeys(panel, opening, line)
  if (drill.opening) url.searchParams.set('opening', drill.opening)
  else url.searchParams.delete('opening')
  if (drill.line) url.searchParams.set('line', drill.line)
  else url.searchParams.delete('line')

  return `${url.pathname}${url.search}${url.hash}`
}

function historyIdx(): number {
  return typeof (window.history.state as UrlGameState | null)?.idx === 'number'
    ? (window.history.state as UrlGameState).idx
    : 0
}

function writeUrlState(state: UrlGameState, mode: 'replace' | 'push'): boolean {
  const panel = state.panel ?? null
  const drill = normalizeDrillKeys(
    panel,
    state.opening ?? null,
    state.line ?? null,
  )
  const gameId = resolveGameIdForUrl(panel, state.gameId)
  const next = toLocation(state.fen, gameId, panel, drill.opening, drill.line)
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const payload: UrlGameState = {
    fen: state.fen,
    gameId,
    idx: state.idx,
    panel,
    opening: drill.opening,
    line: drill.line,
  }
  if (mode === 'push') {
    if (next === current) return false
    window.history.pushState(payload, '', next)
    return true
  }
  window.history.replaceState(payload, '', next)
  return true
}

/** Sync board position (+ coach gameId when the active panel allows it). */
export function replaceGameInUrl(fen: string, gameId: string, idx = 0) {
  const panel = readPanelFromUrl()
  writeUrlState(
    {
      fen,
      gameId,
      idx,
      panel,
      opening: readOpeningFromUrl(),
      line: readLineFromUrl(),
    },
    'replace',
  )
}

/** Push a new history entry for this position. Returns false if URL unchanged. */
export function pushGameToUrl(
  fen: string,
  gameId: string,
  idx: number,
): boolean {
  const panel = readPanelFromUrl()
  return writeUrlState(
    {
      fen,
      gameId,
      idx,
      panel,
      opening: readOpeningFromUrl(),
      line: readLineFromUrl(),
    },
    'push',
  )
}

/**
 * Open/close a panel without adding a history entry.
 * Preserves fen + whatever gameId is already in the URL (stripped only for drill).
 * Does not inject an in-memory gameId — that was causing settings to suddenly grow a gameId after practice.
 */
export function replacePanelInUrl(panel: PanelId | null) {
  writeUrlState(
    {
      fen: readFenFromUrl() ?? START_FEN,
      gameId: readGameIdFromUrl() ?? '',
      idx: historyIdx(),
      panel,
      opening: panel === 'drill' ? readOpeningFromUrl() : null,
      line: panel === 'drill' ? readLineFromUrl() : null,
    },
    'replace',
  )
}

/** Persist the active opening drill line (implies panel=drill, no gameId). */
export function replaceDrillInUrl(
  opening: OpeningId | null,
  line: string | null,
) {
  writeUrlState(
    {
      fen: readFenFromUrl() ?? START_FEN,
      gameId: '',
      idx: historyIdx(),
      panel: 'drill',
      opening,
      line,
    },
    'replace',
  )
}
