import type { DrillProgress } from '@/lib/drills/types'
import { ITALIAN_LINES } from '@/lib/drills/italian'

const KEY = 'chess-3d:italian-drill-progress'

export function loadDrillProgress(): DrillProgress {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { discovered: [], perfected: {} }
    const parsed = JSON.parse(raw) as DrillProgress
    return {
      discovered: Array.isArray(parsed.discovered) ? parsed.discovered : [],
      perfected:
        parsed.perfected && typeof parsed.perfected === 'object'
          ? parsed.perfected
          : {},
    }
  } catch {
    return { discovered: [], perfected: {} }
  }
}

export function saveDrillProgress(next: DrillProgress) {
  localStorage.setItem(KEY, JSON.stringify(next))
}

/** Mark a clean completion (no wrong moves). */
export function recordLineClear(
  prev: DrillProgress,
  lineId: string,
): DrillProgress {
  const discovered = prev.discovered.includes(lineId)
    ? prev.discovered
    : [...prev.discovered, lineId]
  const count = (prev.perfected[lineId] ?? 0) + 1
  return {
    discovered,
    perfected: { ...prev.perfected, [lineId]: count },
  }
}

export function drillStats(progress: DrillProgress) {
  const total = ITALIAN_LINES.length
  const discovered = progress.discovered.filter((id) =>
    ITALIAN_LINES.some((l) => l.id === id),
  ).length
  const perfected = ITALIAN_LINES.filter(
    (l) => (progress.perfected[l.id] ?? 0) >= 3,
  ).length
  return { total, discovered, perfected }
}
