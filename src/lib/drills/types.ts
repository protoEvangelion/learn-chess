export type DrillMove = {
  san: string
  /** Coach tip shown when this ply is about to be played (White) or after it (Black). */
  hint: string
}

export type DrillLine = {
  id: string
  name: string
  /** Short blurb under the title */
  summary: string
  eco?: string
  /** Full ply list, starting 1.e4 … — player answers White plies */
  moves: DrillMove[]
}

export type DrillProgress = {
  /** Line ids completed at least once */
  discovered: string[]
  /** Line id → clean completion count */
  perfected: Record<string, number>
}
