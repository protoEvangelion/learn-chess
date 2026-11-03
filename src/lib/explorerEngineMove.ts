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

export type EngineAdviceSource = 'explorer' | 'browser'

/**
 * Explorer's saved best move when one exists. The browser engine is only
 * the fallback for a position the explorer has not scored.
 */
export function advisedEngineMove(
  explorerBest: { san: string } | null,
  browserSan: string | null | undefined,
): { san: string; source: EngineAdviceSource } | null {
  if (explorerBest?.san) return { san: explorerBest.san, source: 'explorer' }
  if (browserSan) return { san: browserSan, source: 'browser' }
  return null
}

/** Hover text for the green ENGINE label. */
export function engineAdviceLabel(source: EngineAdviceSource): string {
  return source === 'explorer' ? 'Explorer engine' : 'Browser engine'
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
 * Saved eval for the side about to move.
 * The explorer stores White's edge: a positive centipawn is good for White.
 * On Black's turn the sign is flipped, so a higher number is better for Black
 * and a printed plus means good for Black.
 */
export function sideEngineScore(
  move: Pick<ExplorerMove, 'engineCp' | 'engineMate'>,
  side: 'white' | 'black',
): number | null {
  const white = whiteEngineScore(move)
  if (white === null) return null
  return side === 'black' ? -white : white
}

/** Printed eval. Same text as the explorer Engine column, from `side`'s point of view. */
export function sideEngineLabel(
  move: Pick<ExplorerMove, 'engineCp' | 'engineMate'>,
  side: 'white' | 'black',
): string | null {
  const flip = side === 'black' ? -1 : 1
  const mate = move.engineMate
  if (mate !== null && mate !== 0) {
    const shown = mate * flip
    const marks = Math.abs(shown)
    return shown > 0 ? `+M${marks}` : `-M${marks}`
  }
  if (move.engineCp === null) return null
  const shown = move.engineCp * flip
  const text = (Math.abs(shown) / 100).toFixed(2)
  if (shown > 0) return `+${text}`
  if (shown < 0) return `-${text}`
  return '0.00'
}

function sanKey(san: string) {
  return san.replace(/[+#]$/, '')
}

export type RankedExplorerMove<T> = {
  move: T
  /** Higher is better for the side to move. Null when the explorer has no score. */
  score: number | null
  /** Plus is good for the side to move. */
  label: string | null
}

/**
 * Top saved explorer-engine moves for the side to move.
 * Fewer than `limit` when the position has fewer scored moves.
 * The played move stays on the list when it is outside that top, even with no score.
 */
export function rankExplorerEngineMoves<T extends ScoredMove & { san: string }>(
  moves: readonly T[],
  side: 'white' | 'black',
  options?: { limit?: number; playedSan?: string | null },
): RankedExplorerMove<T>[] {
  const limit = options?.limit ?? 5
  const indexed = moves.map((move, index) => ({
    move,
    index,
    score: sideEngineScore(move, side),
  }))
  const scored = indexed.filter(
    (item): item is { move: T; index: number; score: number } => item.score !== null,
  )
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  const picked: { move: T; index: number; score: number | null }[] = scored.slice(0, limit)
  const playedSan = options?.playedSan?.trim() ?? ''
  if (playedSan && !picked.some((item) => sanKey(item.move.san) === sanKey(playedSan))) {
    const played = indexed.find((item) => sanKey(item.move.san) === sanKey(playedSan))
    if (played) picked.push(played)
  }
  return picked.map((item) => ({
    move: item.move,
    score: item.score,
    label: sideEngineLabel(item.move, side),
  }))
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
