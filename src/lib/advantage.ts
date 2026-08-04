import type { BestMoveResult } from './stockfishOpponent'

export type AdvantageView = {
  label: string
  detail: string
  /** 0–100, how much of the bar is White (top when board is normal). */
  whitePercent: number
}

/** Convert White-relative Stockfish score into a display + bar fill. */
export function advantageFromBest(best: BestMoveResult | null): AdvantageView | null {
  if (!best) return null

  if (best.whiteMate != null) {
    const n = Math.abs(best.whiteMate)
    if (best.whiteMate > 0) {
      return {
        label: 'White',
        detail: `mate in ${n}`,
        whitePercent: 96,
      }
    }
    return {
      label: 'Black',
      detail: `mate in ${n}`,
      whitePercent: 4,
    }
  }

  if (best.whiteCp == null) return null

  const pawns = best.whiteCp / 100
  const abs = Math.abs(pawns).toFixed(2)
  // Map roughly ±5 pawns into the bar.
  const clamped = Math.max(-5, Math.min(5, pawns))
  const whitePercent = 50 + (clamped / 5) * 45

  if (Math.abs(pawns) < 0.15) {
    return {
      label: 'Even',
      detail: `${pawns >= 0 ? '+' : ''}${abs}`,
      whitePercent: 50,
    }
  }

  if (pawns > 0) {
    return {
      label: 'White',
      detail: `+${abs}`,
      whitePercent,
    }
  }

  return {
    label: 'Black',
    detail: `+${abs}`,
    whitePercent,
  }
}
