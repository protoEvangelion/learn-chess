import { Chess } from 'chess.js'

const VALUES: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
}

const ORDER = ['q', 'r', 'b', 'n', 'p'] as const

export type MaterialView = {
  /** Positive = White up material (pawn units). */
  whiteScore: number
  whiteCaptures: string[]
  blackCaptures: string[]
}

const START_COUNTS: Record<string, number> = {
  p: 8,
  n: 2,
  b: 2,
  r: 2,
  q: 1,
}

/** Lichess-style material imbalance from a FEN. */
export function materialFromFen(fen: string): MaterialView {
  const empty: MaterialView = {
    whiteScore: 0,
    whiteCaptures: [],
    blackCaptures: [],
  }
  if (!fen || fen.trim().split(/\s+/).length < 4) return empty

  try {
    const chess = new Chess(fen)
    const counts = {
      w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
      b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    }

    for (const row of chess.board()) {
      for (const piece of row) {
        if (!piece || piece.type === 'k') continue
        const side = piece.color === 'w' ? 'w' : 'b'
        const t = piece.type as keyof typeof counts.w
        counts[side][t] += 1
      }
    }

    const whiteCaptures: string[] = []
    const blackCaptures: string[] = []
    let whiteScore = 0
    let blackScore = 0

    for (const t of ORDER) {
      const missingBlack = START_COUNTS[t] - counts.b[t]
      const missingWhite = START_COUNTS[t] - counts.w[t]
      for (let i = 0; i < missingBlack; i++) {
        whiteCaptures.push(t)
        whiteScore += VALUES[t]
      }
      for (let i = 0; i < missingWhite; i++) {
        blackCaptures.push(t)
        blackScore += VALUES[t]
      }
    }

    return {
      whiteScore: whiteScore - blackScore,
      whiteCaptures,
      blackCaptures,
    }
  } catch {
    return empty
  }
}

const GLYPH: Record<string, string> = {
  p: '♟',
  n: '♞',
  b: '♝',
  r: '♜',
  q: '♛',
}

export function materialGlyphs(pieces: string[]): string {
  return pieces.map((p) => GLYPH[p] ?? p).join('')
}
