export type DrillMove = {
  san: string
  /** Coach tip shown when this ply is the one to play. */
  hint: string
  /** Black's win share for this move in the filtered explorer, when we have one. */
  winRate?: string
  /** Engine's best move in the position before this ply, in SAN. */
  engineBest?: string
}

/** Black’s reply system after the Italian Bc4, Philidor sidelines, or the Caro-Kann. */
export type DrillFamilyId =
  | 'giuoco-piano'
  | 'two-knights'
  | 'philidor'
  | 'caro-kann'

export type DrillSide = 'white' | 'black'

export type DrillOpeningId = 'italian' | 'caro-kann'

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
  {
    id: 'caro-kann',
    label: 'Caro-Kann',
    blurb: '…c6 — solid center',
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
  /** Who the human plays. Italian lines omit this and stay White. */
  side?: DrillSide
  /** URL opening key. Italian lines omit this. */
  opening?: DrillOpeningId
  /** Full ply list, starting 1.e4. */
  moves: DrillMove[]
}

export type DrillProgress = {
  /** Line ids completed at least once */
  discovered: string[]
  /** Line id → clean completion count */
  perfected: Record<string, number>
}
