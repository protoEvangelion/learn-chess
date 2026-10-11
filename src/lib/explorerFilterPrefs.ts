import {
  EXPLORER_SPEEDS,
  allRatingBands,
  isExplorerSpeed,
  isRatingBandId,
  normalizeRatings,
  normalizeSpeeds,
  type ExplorerSpeed,
  type RatingBandId,
} from '@/lib/lichessExplorer'

const KEY = 'chess-3d:explorerFilters'

type Stored = {
  ratings?: unknown
  speeds?: unknown
  rangeFrom?: unknown
  rangeTo?: unknown
}

export type StoredExplorerRange = {
  from: Date
  to: Date
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Stored
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function write(patch: Stored) {
  const next = { ...read(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
}

export function loadExplorerRatings(): RatingBandId[] {
  const raw = read().ratings
  if (!Array.isArray(raw)) return allRatingBands()
  const ratings = normalizeRatings(raw.filter((id): id is RatingBandId => typeof id === 'string' && isRatingBandId(id)))
  return ratings.length > 0 ? ratings : allRatingBands()
}

export function saveExplorerRatings(ratings: readonly RatingBandId[]) {
  write({ ratings: normalizeRatings(ratings) })
}

export function loadExplorerSpeeds(): ExplorerSpeed[] {
  const raw = read().speeds
  if (!Array.isArray(raw)) return [...EXPLORER_SPEEDS]
  return normalizeSpeeds(raw.filter((id): id is string => typeof id === 'string' && isExplorerSpeed(id)))
}

export function saveExplorerSpeeds(speeds: readonly ExplorerSpeed[]) {
  write({ speeds: normalizeSpeeds(speeds) })
}

function parseDay(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1) return null
  return date
}

function formatDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** The range the user last picked. Missing until they change the calendar. */
export function loadExplorerRange(): StoredExplorerRange | null {
  const from = parseDay(read().rangeFrom)
  const to = parseDay(read().rangeTo)
  if (!from || !to) return null
  return from <= to ? { from, to } : { from: to, to: from }
}

export function saveExplorerRange(from: Date, to: Date) {
  const start = from <= to ? from : to
  const end = from <= to ? to : from
  write({ rangeFrom: formatDay(start), rangeTo: formatDay(end) })
}
