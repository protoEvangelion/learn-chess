export type DrillMove = {
  san: string
  /** Coach tip shown when this ply is about to be played (White) or after it (Black). */
  hint: string
}

/** Black’s reply system after the Italian Bc4 (or Philidor sidelines). */
export type DrillFamilyId = 'giuoco-piano' | 'two-knights' | 'philidor'

export const DRILL_FAMILIES: Array<{
  id: DrillFamilyId
  label: string
  blurb: string
}> = [
  {
    id: 'giuoco-piano',
    label: 'Giuoco Piano',
    blurb: '…Bc5 — classical Italian',
  },
  {
    id: 'two-knights',
    label: 'Two Knights',
    blurb: '…Nf6 — counterattack',
  },
  {
    id: 'philidor',
    label: 'Philidor',
    blurb: '…d6 — solid center',
  },
]

export type DrillLine = {
  id: string
  name: string
  /** Short blurb under the title */
  summary: string
  eco?: string
  /** Black’s defensive family for grouping in the line picker */
  family: DrillFamilyId
  /** Full ply list, starting 1.e4 … — player answers White plies */
  moves: DrillMove[]
}

export type DrillProgress = {
  /** Line ids completed at least once */
  discovered: string[]
  /** Line id → clean completion count */
  perfected: Record<string, number>
}
