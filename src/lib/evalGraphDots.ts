import type { MoveQualityTag } from '@/lib/gameReview'

/**
 * Which moves earn a coloured dot on the eval graph.
 *
 * chess.com does not dot every move: the graph would turn into confetti on a
 * 40-move game. The rule here is the same idea - mark the moves that changed
 * the story, drop the rest:
 *
 * 1. Every inaccuracy, mistake, and blunder gets a dot (the shifts).
 * 2. A best / excellent move only gets one when it swung the game by at least
 *    DOT_SWING_PAWNS in the mover's favour (a save, not a quiet good move).
 * 3. A delivered checkmate always gets one.
 * 4. Dots closer than DOT_MIN_GAP of the plot width collapse into the more
 *    severe one, so a burst of adjacent moves reads as a single event.
 * 5. At most DOT_MAX dots survive; if there are more, the most severe win.
 */

/** Moves that always get a dot. */
const ALWAYS_DOT: MoveQualityTag[] = ['inaccuracy', 'mistake', 'blunder']

/** Pawns a best / excellent move has to swing before it counts as an event. */
export const DOT_SWING_PAWNS = 1.5

/** Minimum horizontal gap between dots, as a share of the plot width. */
export const DOT_MIN_GAP = 0.035

/** Hard cap so a messy game still reads as a chart, not a bead necklace. */
export const DOT_MAX = 12

/** Higher wins when two dots sit too close together. */
const SEVERITY: Record<MoveQualityTag, number> = {
  blunder: 6,
  mistake: 5,
  inaccuracy: 4,
  best: 3,
  excellent: 2,
  okay: 1,
  theory: 0,
}

export type DotCandidate = {
  ply: number
  /** Horizontal position in the plot, 0–1. */
  x: number
  tag: MoveQualityTag
  /** Pawns the mover gained with this move (negative = lost ground). */
  swing: number
  /** The move delivered checkmate. */
  mate?: boolean
}

function worthDot(candidate: DotCandidate): boolean {
  if (candidate.mate) return true
  if (ALWAYS_DOT.includes(candidate.tag)) return true
  if (candidate.tag === 'best' || candidate.tag === 'excellent') {
    return candidate.swing >= DOT_SWING_PAWNS
  }
  return false
}

/**
 * Dots to draw, left to right. Pure: the same series always gives the same
 * dots, so the graph does not shimmer between renders.
 */
export function pickGraphDots<T extends DotCandidate>(
  candidates: T[],
  opts?: { minGap?: number; max?: number },
): T[] {
  const minGap = opts?.minGap ?? DOT_MIN_GAP
  const max = opts?.max ?? DOT_MAX

  const sorted = candidates
    .filter(worthDot)
    .slice()
    .sort((a, b) => a.x - b.x)

  const kept: T[] = []
  for (const candidate of sorted) {
    const last = kept[kept.length - 1]
    if (last && candidate.x - last.x < minGap) {
      // Two dots in the same cluster: keep the one that hurts more.
      if (SEVERITY[candidate.tag] > SEVERITY[last.tag]) {
        kept[kept.length - 1] = candidate
      }
      continue
    }
    kept.push(candidate)
  }

  if (kept.length <= max) return kept

  return kept
    .slice()
    .sort(
      (a, b) =>
        SEVERITY[b.tag] - SEVERITY[a.tag] ||
        Math.abs(b.swing) - Math.abs(a.swing),
    )
    .slice(0, max)
    .sort((a, b) => a.x - b.x)
}
