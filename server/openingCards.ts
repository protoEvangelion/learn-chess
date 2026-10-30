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
    'caro-trap-panov-rook': {
      themes: ['Accelerated Panov', 'rook on c1', 'queen trap'],
      whitePlan: 'Trade on d5, check with Bb5, and grab the d5-pawn with the queen.',
      blackPlan: 'Jump to c5 and d3, then sack into Rxc1 so White’s queenside cannot move.',
    },
    'caro-trap-na4': {
      themes: ['Two Knights', 'knight on the rim', 'pawn trap'],
      whitePlan: 'Skip d4, prop e4 with f3, and park the knight on a4.',
      blackPlan: 'Kick with …d4, play …e6, then …b5 and threaten to take the rim knight.',
    },
    'caro-trap-nd6': {
      themes: ['smothered mate', 'Qe2 pin', 'White trap'],
      whitePlan: 'After …Bf5, put the queen on e2 and mate with Nd6 if Black plays …Nd7.',
      blackPlan: 'Do not play …Nd7 while the e-pawn is pinned. Develop another way.',
    },
    'caro-trap-h-rook': {
      themes: ['h-pawn storm', 'rook sack', 'promotion'],
      whitePlan: 'Retreat the knight to g3 and try to hold the kingside.',
      blackPlan: 'Push …h5-h4, sack on h2, check with …Qa5+, and promote the h-pawn.',
    },
    'caro-trap-reti': {
      themes: ['Reti mate', 'queen sack', 'White trap'],
      whitePlan: 'Play Qd3, castle long, and meet …Nxe4 with Qd8+ and a bishop mate.',
      blackPlan: 'Do not take the e4-knight after White castles long. Keep developing.',
    },
    'caro-botvinnik-carls': {
      themes: ['Advance', 'd4 attack', 'Botvinnik-Carls'],
      whitePlan: 'Push e5 and hold the d4-pawn.',
      blackPlan: 'Always chip d4 with …c5.',
    },
    'caro-exchange': {
      themes: ['Exchange', 'Rubinstein', 'open c-file'],
      whitePlan: 'Trade on d5, develop the bishop to d3, support with c3, and put the dark bishop on f4.',
      blackPlan: 'Recapture with the c-pawn and develop both knights, …Nc6 and …Nf6.',
    },
    'caro-panov': {
      themes: ['Panov', 'isolated pawn', 'castling'],
      whitePlan: 'Trade on d5, play c4, trade again, and castle after pinning both knights.',
      blackPlan: 'Develop …Nc6, …Nf6, and …Bd6, then castle against the isolated d-pawn.',
    },
    'caro-classical': {
      themes: ['Classical', 'Seirawan', 'bishop trade'],
      whitePlan: 'Chase the light bishop with h4 and h5, trade it on d3, and castle queenside.',
      blackPlan: 'Tuck the bishop to h7, trade it off, and finish with …Bd6.',
    },
    'caro-karpov': {
      themes: ['Karpov', 'knight on g5', 'queen on e4'],
      whitePlan: 'Jump to g5, develop, then drop the knight back to e4 and recapture on e4 with the queen.',
      blackPlan: 'Meet Ng5 with …Ngf6, develop …Bd6, kick the knight with …h6, and trade it off.',
    },
    'caro-tartakower': {
      themes: ['Tartakower', 'Perlis', 'kingside castle'],
      whitePlan: 'Trade knights on f6, develop the bishop to d3, and bring the queen to c2.',
      blackPlan: 'Recapture with the e-pawn, castle, put the bishop on d6, and play …h6.',
    },
    'caro-maroczy': {
      themes: ['Maróczy', 'gambit', 'open center'],
      whitePlan: 'Play f3, recapture on e4 with the f-pawn, and develop the bishop to c4.',
      blackPlan: 'Strike with …e5 and accept the gambit by taking on d4.',
    },
    'caro-two-knights': {
      themes: ['Two Knights', 'Mindeno', 'bishop retreat'],
      whitePlan: 'Develop both knights, then ask the bishop a question with h3.',
      blackPlan: 'Pin the knight with …Bg4 and keep the pin by stepping to h5.',
    },
    'caro-modern': {
      themes: ['Modern', 'knight on d2', 'open e-file'],
      whitePlan: 'Develop the knight to d2, then recapture on e4 with that knight.',
      blackPlan: 'Take on e4. The Classical and the Karpov both start from the recapture.',
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
