/**
 * Vertical scale for the analysis advantage chart.
 *
 * The window is the bigger of "the largest lead in this game" and ±0.75
 * pawns, then opened an extra 18% so the peak sits inside the chart.
 * Zero stays on the center line. The mapping is linear, so a +10 lead is
 * twice as far from the center as a +5 lead in the same game.
 */

/** Quiet games still use this half-window, so small swings stay visible. */
export const EVAL_GRAPH_MIN_HALF = 0.75

/** Extra room past the biggest lead. Peak lands at 1/1.18 of the window. */
export const EVAL_GRAPH_HEADROOM = 1.18

/**
 * Pawns to draw for a forced mate. Mate in 1 is 12; longer mates sit a
 * little lower, still above a +10 material lead, so one mate does not
 * squash the rest of the game the way a raw "100 pawns" would.
 */
export function mateLeadPawns(mateIn: number): number {
  const n = Math.max(1, Math.abs(Math.trunc(mateIn)))
  return 12 - Math.min(n - 1, 10) * 0.15
}

/** Number the chart should plot. The tooltip label wins over a stored pawn value. */
export function seriesPawnValue(point: {
  pawns: number
  label?: string
}): number {
  const label = point.label?.trim()
  if (label && label !== '—') {
    const mate = label.match(/^(-)?M(\d+)$/i)
    if (mate) {
      const lead = mateLeadPawns(Number(mate[2]))
      return mate[1] ? -lead : lead
    }
    const n = Number(label)
    if (Number.isFinite(n)) return n
  }
  return Number.isFinite(point.pawns) ? point.pawns : 0
}

/** Half the chart, in pawns. +half is the top inner edge, -half the bottom. */
export function evalGraphHalfRange(values: number[]): number {
  let peak = 0
  for (const v of values) {
    if (Number.isFinite(v)) peak = Math.max(peak, Math.abs(v))
  }
  return Math.max(peak, EVAL_GRAPH_MIN_HALF) * EVAL_GRAPH_HEADROOM
}

/** SVG y. Smaller y is higher on the chart (White's lead goes up). */
export function evalGraphY(
  pawns: number,
  halfRange: number,
  padY: number,
  plotH: number,
): number {
  const half =
    halfRange > 0 ? halfRange : EVAL_GRAPH_MIN_HALF * EVAL_GRAPH_HEADROOM
  return padY + ((half - pawns) / (2 * half)) * plotH
}
