import { createHash } from 'node:crypto'
import { getTurso } from './turso.js'

export type OpeningLineInput = {
  id: string
  name: string
  eco?: string
  summary: string
  moves: Array<{ san: string; hint?: string }>
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

const CURATION_VERSION = 'curated-v1'
let schemaReady: Promise<void> | null = null

const TWO_KNIGHTS_IDS = new Set([
  'fork-check',
  'central-clamp',
  'loose-queen',
  'pin-royal',
  'structure-crunch',
  'quiet-queen',
])
const PHILIDOR_IDS = new Set([
  'long-castle-battery',
  'trade-and-castle',
  'pinpoint-attack',
])

export function lineContentHash(line: OpeningLineInput): string {
  return createHash('sha256')
    .update(
      [
        line.id,
        line.name,
        line.eco ?? '',
        line.summary,
        line.moves.map((move) => move.san).join(' '),
      ].join('\n'),
    )
    .digest('hex')
    .slice(0, 24)
}

export function formatOpeningCardForCoach(card: OpeningCard): string {
  return [
    `OPENING LINE BRIEF (${card.name}${card.eco ? ` · ${card.eco}` : ''}):`,
    card.blurb,
    `Themes: ${card.themes.join('; ')}`,
    `White plan: ${card.whitePlan}`,
    `Black plan: ${card.blackPlan}`,
    card.traps ? `Traps / pitfalls: ${card.traps}` : null,
    'Coach talking points (use lightly, do not dump all):',
    ...card.talkingPoints.map((point, index) => `${index + 1}. ${point}`),
  ]
    .filter(Boolean)
    .join('\n')
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getTurso()
      .execute(`
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
      .then(() => undefined)
  }
  await schemaReady
}

function familyDetails(line: OpeningLineInput) {
  if (PHILIDOR_IDS.has(line.id)) {
    return {
      label: 'Philidor',
      themes: ['central break', 'development lead', 'queenside castling'],
      whitePlan:
        'Challenge e5 with d4, develop with tempo, and use long castling to launch the kingside pieces.',
      blackPlan:
        'Black reinforces e5 with …d6, develops compactly, and tries to blunt the d-file and diagonal pressure.',
    }
  }
  if (TWO_KNIGHTS_IDS.has(line.id)) {
    return {
      label: 'Two Knights',
      themes: ['open center', 'e-file pressure', 'f7 tactics'],
      whitePlan:
        'Strike with d4, castle quickly, and use the open e-file plus pressure on f7 before Black consolidates.',
      blackPlan:
        'Black attacks e4 with …Nf6 and looks for central pawn grabs while developing with tempo.',
    }
  }
  return {
    label: 'Giuoco Piano',
    themes: ['c3 and d4 break', 'rapid castling', 'initiative'],
    whitePlan:
      'Build the c3–d4 center, castle, and use the open e-file or pressure on f7 while Black’s king is unsettled.',
    blackPlan:
      'Black pressures e4, uses …Bb4 checks, and tries to exchange attackers before completing development.',
  }
}

function curateCard(line: OpeningLineInput): StoredCard {
  const family = familyDetails(line)
  const tactical = /trap|mate|bait|fork|pin|skewer|sacrifice|hunt|attack/i.test(
    `${line.name} ${line.summary}`,
  )
  const hinted = line.moves
    .filter((_, index) => index % 2 === 0)
    .map((move) => move.hint?.trim())
    .filter((hint): hint is string => Boolean(hint))
  const talkingPoints = [...new Set(hinted)].slice(0, 4)

  return {
    lineId: line.id,
    name: line.name,
    eco: line.eco,
    blurb: line.summary,
    themes: [family.label, ...family.themes],
    whitePlan: family.whitePlan,
    blackPlan: family.blackPlan,
    traps: tactical
      ? line.summary
      : 'Do not rush the attack: finish development and verify checks, captures, and threats before committing.',
    talkingPoints: talkingPoints.length
      ? talkingPoints
      : [line.summary, family.whitePlan, 'Keep king safety ahead of material grabs.'],
    contentHash: lineContentHash(line),
    model: CURATION_VERSION,
  }
}

async function readCard(
  lineId: string,
  contentHash?: string,
): Promise<StoredCard | null> {
  await ensureSchema()
  const result = await getTurso().execute({
    sql: `SELECT content_hash, card_json, model
          FROM opening_cards WHERE line_id = ?`,
    args: [lineId],
  })
  const row = result.rows[0]
  if (!row || (contentHash && String(row.content_hash) !== contentHash)) return null
  try {
    const card = JSON.parse(String(row.card_json)) as StoredCard
    return {
      ...card,
      lineId,
      contentHash: String(row.content_hash),
      model: String(row.model || card.model || CURATION_VERSION),
    }
  } catch {
    return null
  }
}

async function writeCard(card: StoredCard) {
  await ensureSchema()
  await getTurso().execute({
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

function normalizeLine(input: OpeningLineInput): OpeningLineInput {
  return {
    id: input.id.trim(),
    name: input.name.trim(),
    eco: input.eco?.trim() || undefined,
    summary: input.summary.trim(),
    moves: input.moves
      .map((move) => ({
        san: String(move.san || '').trim(),
        hint: move.hint?.trim() || undefined,
      }))
      .filter((move) => move.san),
  }
}

/** Read a pregenerated card, reseeding deterministically if its line changed. */
export async function getOrCreateOpeningCard(
  input: OpeningLineInput,
): Promise<OpeningCard> {
  const line = normalizeLine(input)
  if (!line.id || !line.name || line.moves.length === 0) {
    throw new Error('line id, name, and moves required')
  }
  const contentHash = lineContentHash(line)
  const cached = await readCard(line.id, contentHash)
  if (cached) return { ...cached, cached: true }

  const card = curateCard(line)
  await writeCard(card)
  return { ...card, cached: false }
}

export async function getCachedOpeningCard(
  lineId: string,
): Promise<OpeningCard | null> {
  const id = lineId.trim()
  if (!id) return null
  const card = await readCard(id)
  return card ? { ...card, cached: true } : null
}
