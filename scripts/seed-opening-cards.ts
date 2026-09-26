import { ITALIAN_LINES } from '../src/lib/drills/italian.ts'

const baseUrl = process.env.OPENING_CARD_BASE_URL?.replace(/\/$/, '')
if (!baseUrl) {
  throw new Error('Set OPENING_CARD_BASE_URL (for example, https://example.com)')
}

for (const line of ITALIAN_LINES) {
  const response = await fetch(`${baseUrl}/api/opening-card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      line: {
        id: line.id,
        name: line.name,
        eco: line.eco,
        summary: line.summary,
        moves: line.moves.map(({ san, hint }) => ({ san, hint })),
      },
    }),
  })
  const card = (await response.json()) as {
    lineId?: string
    model?: string
    cached?: boolean
    error?: string
  }
  if (!response.ok || !card.lineId) {
    throw new Error(`${line.id}: ${card.error || `HTTP ${response.status}`}`)
  }
  if (card.model !== 'curated-v1') {
    throw new Error(`${line.id}: unexpected card model ${card.model}`)
  }
  console.log(`${card.cached ? 'verified' : 'seeded'} ${card.lineId}`)
}

console.log(`Seeded ${ITALIAN_LINES.length} opening cards in ${baseUrl}`)
