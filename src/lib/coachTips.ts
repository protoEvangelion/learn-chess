export type CoachTips = {
  tip1: string
  tip2: string
  tip3: string
}

/** Parse progressive coach tips from a single LLM reply. */
export function parseCoachTips(raw: string): CoachTips | null {
  const text = raw.trim()
  if (!text) return null

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<CoachTips>
      if (parsed.tip1 && parsed.tip2 && parsed.tip3) {
        return {
          tip1: String(parsed.tip1).trim(),
          tip2: String(parsed.tip2).trim(),
          tip3: String(parsed.tip3).trim(),
        }
      }
    } catch {
      /* fall through to labeled format */
    }
  }

  const tip1 = text.match(/tip\s*1\s*[:\-]\s*([\s\S]*?)(?=tip\s*2\s*[:\-]|$)/i)
  const tip2 = text.match(/tip\s*2\s*[:\-]\s*([\s\S]*?)(?=tip\s*3\s*[:\-]|$)/i)
  const tip3 = text.match(/tip\s*3\s*[:\-]\s*([\s\S]*?)$/i)
  if (tip1?.[1]?.trim() && tip2?.[1]?.trim() && tip3?.[1]?.trim()) {
    return {
      tip1: tip1[1].trim(),
      tip2: tip2[1].trim(),
      tip3: tip3[1].trim(),
    }
  }

  return null
}
