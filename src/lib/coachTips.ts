/** Single-card coach reply (move + alternatives in one explanation). */
export type CoachExplainResult = {
  explanation: string
}

/**
 * Parse `{ "explanation": "..." }` (also accepts legacy tip1/tip2/tip3 / compareNote).
 */
export function parseCoachExplain(raw: string): CoachExplainResult | null {
  const text = raw.trim()
  if (!text) return null

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        explanation?: unknown
        compareNote?: unknown
        options?: Array<{ tip1?: unknown; tip2?: unknown; tip3?: unknown }>
        tip1?: unknown
        tip2?: unknown
        tip3?: unknown
      }

      if (typeof parsed.explanation === 'string' && parsed.explanation.trim()) {
        return { explanation: parsed.explanation.trim() }
      }

      // Legacy MultiPV progressive tips → one combined card.
      const parts: string[] = []
      if (typeof parsed.compareNote === 'string' && parsed.compareNote.trim()) {
        parts.push(parsed.compareNote.trim())
      }
      if (Array.isArray(parsed.options) && parsed.options[0]) {
        const o = parsed.options[0]
        for (const key of ['tip1', 'tip2', 'tip3'] as const) {
          const v = o[key]
          if (typeof v === 'string' && v.trim()) parts.push(v.trim())
        }
      } else {
        for (const key of ['tip1', 'tip2', 'tip3'] as const) {
          const v = parsed[key]
          if (typeof v === 'string' && v.trim()) parts.push(v.trim())
        }
      }
      if (parts.length > 0) return { explanation: parts.join('\n\n') }
    } catch {
      /* fall through */
    }
  }

  // Plain prose fallback
  if (text.length > 20 && !text.startsWith('{')) {
    return { explanation: text }
  }

  return null
}
