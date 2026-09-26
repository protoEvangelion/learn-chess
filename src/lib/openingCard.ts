import type { DrillLine } from '@/lib/drills/types'

export type OpeningCard = {
  lineId: string
  name: string
  eco?: string
  blurb: string
  themes: string[]
  whitePlan: string
  blackPlan: string
  traps: string
  talkingPoints: string[]
  contentHash: string
  cached: boolean
  model: string
}

const memory = new Map<string, OpeningCard>()
const inflight = new Map<string, Promise<OpeningCard>>()

/** Fetch a pregenerated, Turso-backed opening briefing. */
export async function fetchOpeningCard(line: DrillLine): Promise<OpeningCard> {
  const hit = memory.get(line.id)
  if (hit) return hit

  const pending = inflight.get(line.id)
  if (pending) return pending

  const job = (async () => {
    const res = await fetch('/api/opening-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line: {
          id: line.id,
          name: line.name,
          eco: line.eco,
          summary: line.summary,
          moves: line.moves.map((m) => ({ san: m.san, hint: m.hint })),
        },
      }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as {
        error?: string
      } | null
      throw new Error(err?.error || `opening-card failed (${res.status})`)
    }
    const card = (await res.json()) as OpeningCard
    memory.set(line.id, card)
    return card
  })().finally(() => {
    inflight.delete(line.id)
  })

  inflight.set(line.id, job)
  return job
}
