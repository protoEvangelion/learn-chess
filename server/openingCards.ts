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

function caroFamilyDetails(id: string) {
  const plans: Record<string, { themes: string[]; whitePlan: string; blackPlan: string }> = {
    'caro-loose-bishop': {
      themes: ['loose bishop', 'pin on the knight', 'material grab'],
      whitePlan: 'Develop the bishop to c4 early, then try to open the center with d3.',
      blackPlan: 'Take the bishop with …dxc4 and pin the knight with …Bg4.',
    },
    'caro-bishop-grab': {
      themes: ['Hillbilly', 'loose piece', 'queen recapture'],
      whitePlan: 'Play Bc4, trade on d5, and capture the d5-pawn with the bishop.',
      blackPlan: 'Hit back with …d5 and …cxd5, then take the bishop with the queen.',
    },
    'caro-queen-raid': {
      themes: ['early queen', 'central counter', 'recapture'],
      whitePlan: 'Bring the queen out to h5 and trade on d5.',
      blackPlan: 'Ignore the queen, play …d5, and recapture with the c-pawn.',
    },
    'caro-hillbilly': {
      themes: ['Hillbilly', 'bishop retreat', 'pin on the knight'],
      whitePlan: 'Play Bc4, trade on d5, drop the bishop to b3, and build with d4.',
      blackPlan: 'Recapture on d5, develop the knight, and pin with …Bg4.',
    },
    'caro-advance-pin': {
      themes: ['d4 attack', 'pin on the knight', 'f5 outpost'],
      whitePlan: 'Push e5, hold d4, and try to break the pin on the f3-knight.',
      blackPlan: 'Chip d4 with …c5, pin the knight, and plant a knight on f5.',
    },
    'caro-exchange': {
      themes: ['open c-file', 'knight development', 'pin on the knight'],
      whitePlan: 'Trade on d5, develop Nf3 and Nc3, and live with the pin.',
      blackPlan: 'Recapture with the c-pawn, develop …Nc6, and pin the knight with …Bg4.',
    },
    'caro-classical': {
      themes: ['open e-file', 'knight trade', 'central pawn duo'],
      whitePlan: 'Play Nc3, recapture on e4, and trade knights on f6.',
      blackPlan: 'Take on e4, play …Nf6, and recapture with the e-pawn.',
    },
    'caro-fantasy': {
      themes: ['weakened diagonal', 'central strike', 'queen pressure'],
      whitePlan: 'Play f3 and take on e5, opening the diagonal toward the king.',
      blackPlan: 'Skip the pawn grab. Play …e5 and bring the queen to b6.',
    },
    'caro-modern': {
      themes: ['knight on d2', 'Classical transposition', 'open e-file'],
      whitePlan: 'Develop the knight to d2, recapture on e4, and trade on f6.',
      blackPlan: 'Take on e4 and meet the Classical board with …Nf6 and …exf6.',
    },
  }
  const plan = plans[id] ?? {
    themes: ['solid center', 'development', 'king safety'],
    whitePlan: 'Claim the center and develop before opening the position.',
    blackPlan: 'Hold the center with …c6 and …d5, then develop the minor pieces.',
  }
  return { label: 'Caro-Kann', ...plan }
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
  if (line.id.startsWith('caro-')) {
    return caroFamilyDetails(line.id)
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
  const playerStep = line.id.startsWith('caro-') ? 1 : 0
  const hinted = line.moves
    .filter((_, index) => index % 2 === playerStep)
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
