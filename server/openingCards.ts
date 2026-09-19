import { createHash } from 'node:crypto'
import { getTurso } from './turso.ts'
import { askCursorOnce, EXPLAIN_MODEL } from './cursorAsk.ts'

export type OpeningLineInput = {
  id: string
  name: string
  eco?: string
  summary: string
  moves: Array<{ san: string }>
}

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

type StoredCard = Omit<OpeningCard, 'cached'>

const inflight = new Map<string, Promise<OpeningCard>>()

let schemaReady: Promise<void> | null = null

export function lineContentHash(line: OpeningLineInput): string {
  const payload = [
    line.id,
    line.name,
    line.eco ?? '',
    line.summary,
    line.moves.map((m) => m.san).join(' '),
  ].join('\n')
  return createHash('sha256').update(payload).digest('hex').slice(0, 24)
}

export function formatOpeningCardForCoach(card: OpeningCard): string {
  const themes = card.themes.length ? card.themes.join('; ') : '—'
  const points = card.talkingPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')
  return [
    `OPENING LINE BRIEF (${card.name}${card.eco ? ` · ${card.eco}` : ''}):`,
    card.blurb,
    `Themes: ${themes}`,
    `White plan: ${card.whitePlan}`,
    `Black plan: ${card.blackPlan}`,
    card.traps ? `Traps / pitfalls: ${card.traps}` : null,
    'Coach talking points (use lightly, do not dump all):',
    points,
  ]
    .filter(Boolean)
    .join('\n')
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = getTurso()
      await db.execute(`
        CREATE TABLE IF NOT EXISTS opening_cards (
          line_id TEXT PRIMARY KEY,
          content_hash TEXT NOT NULL,
          name TEXT NOT NULL,
          eco TEXT,
          card_json TEXT NOT NULL,
          model TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)
    })()
  }
  await schemaReady
}

function fallbackCard(line: OpeningLineInput, contentHash: string): StoredCard {
  return {
    lineId: line.id,
    name: line.name,
    eco: line.eco,
    blurb: line.summary,
    themes: [line.name],
    whitePlan: line.summary,
    blackPlan: 'Contest the center and complete development.',
    traps: '',
    talkingPoints: [line.summary],
    contentHash,
    model: 'fallback',
  }
}

function parseCardJson(
  raw: string,
  line: OpeningLineInput,
  contentHash: string,
): StoredCard {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('No JSON object in opening-card reply')
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<StoredCard>

  const themes = Array.isArray(parsed.themes)
    ? parsed.themes.map(String).filter(Boolean).slice(0, 6)
    : []
  const talkingPoints = Array.isArray(parsed.talkingPoints)
    ? parsed.talkingPoints.map(String).filter(Boolean).slice(0, 5)
    : []

  return {
    lineId: line.id,
    name: line.name,
    eco: line.eco,
    blurb: String(parsed.blurb || line.summary).trim(),
    themes: themes.length ? themes : [line.name],
    whitePlan: String(parsed.whitePlan || '').trim() || line.summary,
    blackPlan:
      String(parsed.blackPlan || '').trim() ||
      'Contest the center and complete development.',
    traps: String(parsed.traps || '').trim(),
    talkingPoints: talkingPoints.length ? talkingPoints : [line.summary],
    contentHash,
    model: EXPLAIN_MODEL,
  }
}

function buildGeneratePrompt(line: OpeningLineInput): string {
  const moves = line.moves.map((m, i) => `${i + 1}. ${m.san}`).join(' ')
  return [
    'You are a chess opening coach writing a SHORT briefing card for one drill line.',
    'Be accurate, concrete, and concise. No fluff, no move-by-move novel.',
    'Audience: beginner–club player practicing this line as White.',
    '',
    'Reply with ONLY a single JSON object (no markdown fences):',
    '{',
    '  "blurb": "2–3 short sentences: what this line is and the main idea",',
    '  "themes": ["3–5 short theme labels"],',
    '  "whitePlan": "1–2 sentences: White’s plan in this line",',
    '  "blackPlan": "1–2 sentences: what Black is trying",',
    '  "traps": "1–2 sentences on key traps/pitfalls, or empty string",',
    '  "talkingPoints": ["3–5 one-sentence coach tips for this line"]',
    '}',
    '',
    `Line id: ${line.id}`,
    `Name: ${line.name}`,
    `ECO: ${line.eco ?? 'unknown'}`,
    `Summary: ${line.summary}`,
    `Moves (SAN): ${moves}`,
  ].join('\n')
}

async function readCached(
  lineId: string,
  contentHash: string,
): Promise<StoredCard | null> {
  await ensureSchema()
  const db = getTurso()
  const result = await db.execute({
    sql: `SELECT line_id, content_hash, name, eco, card_json, model
          FROM opening_cards WHERE line_id = ?`,
    args: [lineId],
  })
  const row = result.rows[0]
  if (!row) return null
  if (String(row.content_hash) !== contentHash) return null
  try {
    const card = JSON.parse(String(row.card_json)) as StoredCard
    return {
      ...card,
      lineId,
      contentHash,
      model: String(row.model || card.model || EXPLAIN_MODEL),
    }
  } catch {
    return null
  }
}

async function writeCached(card: StoredCard) {
  await ensureSchema()
  const db = getTurso()
  await db.execute({
    sql: `
      INSERT INTO opening_cards (line_id, content_hash, name, eco, card_json, model, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(line_id) DO UPDATE SET
        content_hash = excluded.content_hash,
        name = excluded.name,
        eco = excluded.eco,
        card_json = excluded.card_json,
        model = excluded.model,
        updated_at = datetime('now')
    `,
    args: [
      card.lineId,
      card.contentHash,
      card.name,
      card.eco ?? null,
      JSON.stringify(card),
      card.model,
    ],
  })
}

async function generateCard(
  line: OpeningLineInput,
  contentHash: string,
): Promise<StoredCard> {
  try {
    const raw = await askCursorOnce(buildGeneratePrompt(line))
    return parseCardJson(raw, line, contentHash)
  } catch (err) {
    console.warn('[opening-cards] LLM generate failed, using fallback:', err)
    return fallbackCard(line, contentHash)
  }
}

function normalizeLine(input: OpeningLineInput): OpeningLineInput {
  return {
    id: input.id.trim(),
    name: input.name.trim(),
    eco: input.eco?.trim() || undefined,
    summary: input.summary.trim(),
    moves: input.moves
      .map((m) => ({ san: String(m.san || '').trim() }))
      .filter((m) => m.san),
  }
}

/** Lazy get-or-generate opening briefing for a drill line. */
export async function getOrCreateOpeningCard(
  input: OpeningLineInput,
): Promise<OpeningCard> {
  const line = normalizeLine(input)
  if (!line.id || !line.name || line.moves.length === 0) {
    throw new Error('line id, name, and moves required')
  }

  const contentHash = lineContentHash(line)
  const cached = await readCached(line.id, contentHash)
  if (cached) return { ...cached, cached: true }

  // Never block the UI on LLM — return the hand summary now, fill Turso in background.
  if (!inflight.has(line.id)) {
    const job = (async () => {
      const card = await generateCard(line, contentHash)
      await writeCached(card)
      return { ...card, cached: false }
    })()
      .catch((err) => {
        console.warn('[opening-cards] background generate failed:', err)
        return { ...fallbackCard(line, contentHash), cached: false }
      })
      .finally(() => {
        inflight.delete(line.id)
      })
    inflight.set(line.id, job)
  }

  return { ...fallbackCard(line, contentHash), cached: false }
}

/** Load a previously cached card by id (no generate). Used for coach inject. */
export async function getCachedOpeningCard(
  lineId: string,
): Promise<OpeningCard | null> {
  const id = lineId.trim()
  if (!id) return null
  await ensureSchema()
  const db = getTurso()
  const result = await db.execute({
    sql: `SELECT line_id, content_hash, card_json, model FROM opening_cards WHERE line_id = ?`,
    args: [id],
  })
  const row = result.rows[0]
  if (!row) return null
  try {
    const card = JSON.parse(String(row.card_json)) as StoredCard
    return {
      ...card,
      lineId: id,
      contentHash: String(row.content_hash),
      model: String(row.model || card.model || EXPLAIN_MODEL),
      cached: true,
    }
  } catch {
    return null
  }
}
