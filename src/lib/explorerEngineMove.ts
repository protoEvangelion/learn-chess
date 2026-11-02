import type { ExplorerMove } from '@/lib/lichessExplorer'

type ScoredMove = Pick<ExplorerMove, 'uci' | 'engineCp' | 'engineMate'>

/**
 * White's edge after the move. Higher is better for White.
 * A shorter mate outranks any centipawn score. No saved score returns null.
 */
export function whiteEngineScore(move: Pick<ExplorerMove, 'engineCp' | 'engineMate'>): number | null {
  const mate = move.engineMate
  if (mate !== null && mate !== 0) {
    return mate > 0 ? 1_000_000 - mate : -1_000_000 - mate
  }
  if (move.engineCp !== null) return move.engineCp
  return null
}

/** Saved explorer-engine move that is best for the side about to play. */
export function bestExplorerEngineMove<T extends ScoredMove>(
  moves: readonly T[],
  side: 'white' | 'black',
): T | null {
  let best: T | null = null
  let bestScore = 0
  for (const move of moves) {
    const score = whiteEngineScore(move)
    if (score === null) continue
    if (!best) {
      best = move
      bestScore = score
      continue
    }
    const better = side === 'white' ? score > bestScore : score < bestScore
    if (better) {
      best = move
      bestScore = score
    }
  }
  return best
}

/**
 * The single worst saved score for White, and only when White is to move.
 * Equal scores are not "worst". The best move is never also marked worst.
 */
export function worstWhiteExplorerMove<T extends ScoredMove>(
  moves: readonly T[],
  side: 'white' | 'black',
): T | null {
  if (side !== 'white') return null
  const best = bestExplorerEngineMove(moves, 'white')
  if (!best) return null
  const bestScore = whiteEngineScore(best)
  let worst: T | null = null
  let worstScore = 0
  for (const move of moves) {
    const score = whiteEngineScore(move)
    if (score === null) continue
    if (!worst || score < worstScore) {
      worst = move
      worstScore = score
    }
  }
  if (!worst || worst.uci === best.uci || worstScore === bestScore) return null
  return worst
}
