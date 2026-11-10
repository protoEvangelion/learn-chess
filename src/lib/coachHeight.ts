const KEY = 'chess-3d:reviewCoachFraction'

export const DEFAULT_REVIEW_COACH_FRACTION = 0.5
export const MIN_REVIEW_COACH_FRACTION = 0.28
export const MAX_REVIEW_COACH_FRACTION = 0.8

export function clampReviewCoachFraction(fraction: number) {
  return Math.min(
    MAX_REVIEW_COACH_FRACTION,
    Math.max(MIN_REVIEW_COACH_FRACTION, fraction),
  )
}

export function loadReviewCoachFraction(): number {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored == null || stored === '') return DEFAULT_REVIEW_COACH_FRACTION
    const value = Number(stored)
    if (!Number.isFinite(value)) return DEFAULT_REVIEW_COACH_FRACTION
    return clampReviewCoachFraction(value)
  } catch {
    return DEFAULT_REVIEW_COACH_FRACTION
  }
}

export function saveReviewCoachFraction(fraction: number) {
  try {
    localStorage.setItem(KEY, String(clampReviewCoachFraction(fraction)))
  } catch {
    // Storage can be unavailable (private mode / blocked cookies).
  }
}
