export type DrillMoveAlert = {
  title: string
  description: string
  /** Cult Halo rim palette. Default destructive for STOP callouts. */
  rimVariant?: 'default' | 'success' | 'destructive'
  /**
   * SAN sequence from the current board that shows the danger / idea
   * (e.g. the mate if you take the hanging piece). Halo offers Preview.
   */
  preview?: string[]
}

export type DrillMove = {
  san: string
  /** Coach tip shown when this ply is the one to play. */
  hint: string
  /** Optional Halo callout when this ply is the one to play. */
  alert?: DrillMoveAlert
  /**
   * Show the line's `summary` as a Halo "Core idea" on this ply only —
   * the step where the idea becomes clear.
   */
  revealIdea?: boolean
  /**
   * Optional board preview from this ply (also via `alert.preview`).
   * Only show a Preview control when this resolves to a non-empty list.
   */
  preview?: string[]
}

/** Preview SANs for a ply, if any (alert or move-level). */
export function drillPlyPreview(move: DrillMove | undefined): string[] | null {
  const sans = move?.preview ?? move?.alert?.preview
  return sans && sans.length > 0 ? sans : null
}

/** Black’s reply system after the Italian Bc4, Philidor sidelines, or the Caro-Kann. */
export type DrillFamilyId =
  | 'giuoco-piano'
  | 'two-knights'
  | 'philidor'
  | 'caro-kann'

export type DrillSide = 'white' | 'black'

export type DrillOpeningId = 'italian' | 'caro-kann'

/** Heading text for each opening pack. Order in the picker comes from the lines. */
export const DRILL_OPENING_TITLES: Record<DrillOpeningId, string> = {
  italian: 'Italian Opening',
  'caro-kann': 'Caro-Kann',
}

/** Italian lines omit `opening` and stay in that pack. */
export function drillOpeningId(line: { opening?: DrillOpeningId }): DrillOpeningId {
  return line.opening ?? 'italian'
}

const OPENING_PREF_KEY = 'chess-3d:drill-opening'

export function isDrillOpeningId(value: string): value is DrillOpeningId {
  return value === 'italian' || value === 'caro-kann'
}

/** Last opening the user picked in the drill panel (falls back to Italian). */
export function loadDrillOpening(): DrillOpeningId {
  try {
    const raw = localStorage.getItem(OPENING_PREF_KEY)?.trim() ?? ''
    if (isDrillOpeningId(raw)) return raw
  } catch {
    /* private mode */
  }
  return 'italian'
}

export function saveDrillOpening(opening: DrillOpeningId) {
  try {
    localStorage.setItem(OPENING_PREF_KEY, opening)
  } catch {
    /* private mode */
  }
}

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
