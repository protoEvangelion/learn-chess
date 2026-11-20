import {
  stockfishAnalysis,
  type BestMoveResult,
} from '@/lib/stockfishOpponent'

/**
 * MultiPV lines used to fill sparse explorer positions.
 * Depth 14 is enough for a move list and keeps the first search quick.
 */
const FILL_DEPTH = 14
const FILL_MULTI_PV = 6

const cache = new Map<string, BestMoveResult[]>()

/** Cached Stockfish top lines for a position. */
export async function engineFillLines(
  fen: string,
  signal?: AbortSignal,
): Promise<BestMoveResult[]> {
  const cached = cache.get(fen)
  if (cached) return cached
  const { lines } = await stockfishAnalysis.getBestMove(fen, signal, {
    depth: FILL_DEPTH,
    multiPv: FILL_MULTI_PV,
  })
  cache.set(fen, lines)
  return lines
}
