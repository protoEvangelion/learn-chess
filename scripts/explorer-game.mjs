import { Chess } from 'chessops/chess'
import { makeFen } from 'chessops/fen'
import { parseSan } from 'chessops/san'

export const WIDTH = 2 ** 28
export const DEPTH = 4
export const MASK = WIDTH - 1
export const PLY_CAP = 50
export const START_EPD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'
const PROMO = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }
const BANDS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]

export function sketchBytes() {
  return DEPTH * WIDTH * 2
}

export function viewsFrom(buffer) {
  const rowBytes = WIDTH * 2
  return Array.from({ length: DEPTH }, (_, row) => new Uint16Array(buffer, row * rowBytes, WIDTH))
}

function bandOf(avg) {
  let band = 0
  for (const value of BANDS) if (avg >= value) band = value
  return String(band)
}

function speedOf(timeControl) {
  const match = /^(\d+)\+(\d+)$/.exec(timeControl || '')
  if (!match) return null
  const total = Number(match[1]) + 40 * Number(match[2])
  if (total >= 180 && total <= 479) return 'blitz'
  if (total >= 480 && total <= 1499) return 'rapid'
  if (total >= 1500 && total <= 21599) return 'classical'
  return null
}

function sanTokens(text) {
  const cleaned = text.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ')
  const out = []
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw || raw === '1-0' || raw === '0-1' || raw === '1/2-1/2' || raw === '*') continue
    if (/^\d+\.+$/.test(raw)) continue
    out.push(raw.replace(/[?!]+$/, ''))
  }
  return out
}

function uciOf(move) {
  if (!move || move.from === undefined) return ''
  const name = (square) => 'abcdefgh'[square & 7] + '12345678'[square >> 3]
  let uci = name(move.from) + name(move.to)
  if (move.promotion) uci += PROMO[move.promotion] || ''
  return uci
}

export function hashParts(parts) {
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  for (const part of parts) {
    h1 = Math.imul(h1 ^ 255, 0x01000193)
    h2 = Math.imul(h2 ^ 255, 0x85ebca6b)
    for (let i = 0; i < part.length; i += 1) {
      const code = part.charCodeAt(i)
      h1 = Math.imul(h1 ^ code, 0x01000193)
      h2 = Math.imul(h2 ^ code, 0x85ebca6b)
    }
  }
  return [h1 >>> 0, (h2 >>> 0) | 1]
}

export function slot(h1, h2, row) {
  return ((h1 + Math.imul(row, h2)) >>> 0) & MASK
}

export function sketchAddAtomic(views, h1, h2) {
  for (let row = 0; row < DEPTH; row += 1) {
    const view = views[row]
    const index = slot(h1, h2, row)
    while (true) {
      const value = Atomics.load(view, index)
      if (value >= 65535) break
      if (Atomics.compareExchange(view, index, value, value + 1) === value) break
    }
  }
}

export function sketchEstimate(views, h1, h2) {
  let min = 65535
  for (let row = 0; row < DEPTH; row += 1) {
    const value = Atomics.load(views[row], slot(h1, h2, row))
    if (value < min) min = value
  }
  return min
}

export function headersOf(game) {
  const headers = {}
  const re = /^\[(\w+)\s+"(.*)"\]$/gm
  let match
  while ((match = re.exec(game))) headers[match[1]] = match[2]
  return headers
}

export function bodyOf(game) {
  const split = game.indexOf('\n\n')
  return split >= 0 ? game.slice(split + 2) : ''
}

export function consider(headers) {
  const result = headers.Result
  const whiteElo = Number(headers.WhiteElo)
  const blackElo = Number(headers.BlackElo)
  const speed = speedOf(headers.TimeControl || '')
  if (
    !speed ||
    (result !== '1-0' && result !== '0-1' && result !== '1/2-1/2') ||
    !Number.isFinite(whiteElo) ||
    !Number.isFinite(blackElo) ||
    headers.WhiteTitle === 'BOT' ||
    headers.BlackTitle === 'BOT' ||
    (headers.Variant && headers.Variant !== 'Standard')
  ) {
    return null
  }
  return {
    speed,
    band: bandOf((whiteElo + blackElo) / 2),
    outcome: result === '1-0' ? 0 : result === '1/2-1/2' ? 1 : 2,
  }
}

export function forEachPly(body, onPosition, onMove) {
  const chess = Chess.default()
  const sans = sanTokens(body)
  const plies = Math.min(sans.length, PLY_CAP)
  if (plies === 0) return
  for (let ply = 0; ply < plies; ply += 1) {
    const before = makeFen(chess.toSetup(), { epd: true })
    const parsed = parseSan(chess, sans[ply])
    if (!parsed) {
      onPosition(before)
      return
    }
    onPosition(before)
    onMove(before, uciOf(parsed), sans[ply])
    chess.play(parsed)
  }
  onPosition(makeFen(chess.toSetup(), { epd: true }))
}

const SPEED_CODE = { blitz: 1, rapid: 2, classical: 3 }
const BAND_CODE = { 0: 1, 1000: 2, 1200: 3, 1400: 4, 1600: 5, 1800: 6, 2000: 7, 2200: 8, 2500: 9 }
const SPEED_NAME = ['', 'blitz', 'rapid', 'classical']
const BAND_NAME = ['', '0', '1000', '1200', '1400', '1600', '1800', '2000', '2200', '2500']

/** One count cell as bytes. Kind 1 is a board, kind 2 is a move. */
export function encodeCell(kind, speed, band, fen, cell, uci = '', san = '') {
  const fenBuf = Buffer.from(fen)
  const uciBuf = Buffer.from(uci)
  const sanBuf = Buffer.from(san)
  const extra = kind === 2 ? 2 + uciBuf.length + sanBuf.length : 0
  const buf = Buffer.allocUnsafe(17 + fenBuf.length + extra)
  let o = 0
  buf[o++] = kind
  buf[o++] = SPEED_CODE[speed]
  buf[o++] = BAND_CODE[band]
  buf.writeUInt32LE(cell[0], o)
  o += 4
  buf.writeUInt32LE(cell[1], o)
  o += 4
  buf.writeUInt32LE(cell[2], o)
  o += 4
  buf.writeUInt16LE(fenBuf.length, o)
  o += 2
  fenBuf.copy(buf, o)
  o += fenBuf.length
  if (kind === 2) {
    buf[o++] = uciBuf.length
    uciBuf.copy(buf, o)
    o += uciBuf.length
    buf[o++] = sanBuf.length
    sanBuf.copy(buf, o)
  }
  return buf
}

/** Parse complete records from `buffer`. Returns how many bytes were consumed. */
export function parseSpill(buffer, onRecord) {
  let o = 0
  while (o + 17 <= buffer.length) {
    const kind = buffer[o]
    const fenLen = buffer.readUInt16LE(o + 15)
    let need = 17 + fenLen
    if (kind === 2) {
      if (o + need + 1 > buffer.length) break
      const uciLen = buffer[o + need]
      if (o + need + 2 + uciLen > buffer.length) break
      const sanLen = buffer[o + need + 1 + uciLen]
      need += 2 + uciLen + sanLen
    }
    if (o + need > buffer.length) break
    const fen = buffer.toString('utf8', o + 17, o + 17 + fenLen)
    let uci = ''
    let san = ''
    if (kind === 2) {
      const u0 = o + 17 + fenLen
      uci = buffer.toString('utf8', u0 + 1, u0 + 1 + buffer[u0])
      const s0 = u0 + 1 + buffer[u0]
      san = buffer.toString('utf8', s0 + 1, s0 + 1 + buffer[s0])
    }
    onRecord({
      kind,
      speed: SPEED_NAME[buffer[o + 1]],
      band: BAND_NAME[buffer[o + 2]],
      fen,
      white: buffer.readUInt32LE(o + 3),
      draws: buffer.readUInt32LE(o + 7),
      black: buffer.readUInt32LE(o + 11),
      uci,
      san,
    })
    o += need
  }
  return o
}
