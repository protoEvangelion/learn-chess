import { Chess } from 'chess.js'
import { randomUUID } from 'node:crypto'
import type { Plugin } from 'vite'
import {
  reviewCoachVoice,
  sideForUsername,
  type PlayerSide,
} from '../src/lib/playerSide.js'
import {
  EXPLAIN_MODEL,
  streamCoachAsk,
} from './aiCoach.js'
import { listExplorerMonths, queryExplorerPosition } from './explorerStats.js'
import {
  allRatingBands,
  ratingBandForElo,
  ratingBandRangeLabel,
} from '../src/lib/lichessExplorer.js'
import { readExplorerQuery } from './lichessExplorerProxy.js'
import {
  loadBlackDefenses,
  loadOpeningBranch,
  purgeExpiredExplorerBranches,
} from './openingBranch.js'
import { loadServerEnv } from './loadServerEnv.js'

loadServerEnv()

export { EXPLAIN_MODEL } from './aiCoach.js'

type OpeningLineInput = {
  id: string
  name: string
  eco?: string
  summary: string
  moves: Array<{ san: string; hint?: string }>
}

export type ExplainOption = {
  bestMove: string
  from: string
  to: string
  evalLabel: string
  line: string
}

export type ExplainRequest = {
  fen: string
  gameId: string
  /** Engine MultiPV lines (1–3); tips must align per option. */
  options: ExplainOption[]
  /** Fullmove-ish hint so the coach can talk about game phase. */
  plyHint?: string
  /** Drill / opening practice line — injects a cached briefing into the prompt. */
  openingLineId?: string
}

export type OpeningCatalogEntry = {
  id: string
  name: string
  eco?: string
  summary: string
  /** Space-joined SAN path for the drill line. */
  moves: string
}

export type CoachChatRequest = {
  gameId: string
  fen: string
  question: string
  bestMove?: string
  evalLabel?: string
  /** Full coach card text for this position (if already asked). */
  explanation?: string
  /** Top engine lines when tips have not been requested yet. */
  engineLines?: Array<{
    uci: string
    from: string
    to: string
    evalLabel: string
  }>
  /** Drill / opening practice line — injects a cached briefing into the prompt. */
  openingLineId?: string
  /**
   * Compact catalog of practiced opening drills (e.g. Italian pack).
   * Lets post-game chat answer “could I have used my lines better?”.
   */
  openingCatalog?: OpeningCatalogEntry[]
  /** Short game-review context when chatting from the analysis report tab. */
  reviewBrief?: string
  /**
   * The human's side in an imported game. When set, "you" means this color,
   * not whoever is about to move.
   */
  playerColor?: PlayerSide
  /** Recent visible chat turns; AI Gateway requests are stateless. */
  messages?: Array<{ role: 'user' | 'assistant'; text: string }>
}

export type ReviewPlyPayload = {
  ply: number
  fen: string
  san: string
  by: 'player' | 'opponent'
  tag?: 'best' | 'inaccuracy' | 'mistake' | 'blunder'
  playedEval?: string
  bestSan?: string
  bestEval?: string
}

export type ReviewRequest = {
  gameId: string
  playerColor: 'white' | 'black'
  outcome: 'win' | 'loss' | 'draw' | 'unknown'
  /** This player's Elo from the PGN, when the game recorded one. */
  playerElo?: number | null
  plies: ReviewPlyPayload[]
}

/** Stable prefix — keep identical across asks for prompt-cache friendliness. */
const COACH_RULES = [
  'You are a friendly chess coach helping a beginner–club player.',
  'You are coaching ONE ongoing game. Earlier messages in this chat are prior tips for earlier positions—use that arc.',
  'Relate new advice to how the game has progressed when useful.',
  '',
  'This card is about the side to move in POSITION FACTS. Speak as “you” to that side.',
  'You may mention the other side’s threat in a short clause so the move makes sense.',
  'Every move you name as playable must be copied from LEGAL MOVES (SAN). Do not invent a move.',
  '',
  'You will receive ONE OR MORE engine move OPTIONS (ranked best → alternatives) for the side to move.',
  'Write ONE short coaching card that:',
  '1) Recommends option 1 when it is in LEGAL MOVES (prefer SAN + from→to) and why it fits now,',
  '2) Briefly mentions how options 2/3 compare (or that they are close), using evals when helpful.',
  'UCI moves are long algebraic coordinates only: <from><to>[promotion] (examples: e2e4, e1g1 = castle, e7e8q = promote).',
  'UCI never names the piece; the mover is whatever occupies <from> in the FEN.',
  'If an engine option is not in LEGAL MOVES, ignore it.',
  'If earlier tips in this chat pointed at a move that is not in LEGAL MOVES, course-correct toward these engine options.',
  '',
  'Reply with ONLY a single JSON object (no markdown fences, no other text):',
  '{"explanation":"..."}',
  'explanation: 4–8 short sentences, plain English, no markdown headings or bullet lists.',
].join('\n')

/** Follow-up Q&A about the position, tips, and recommended move. */
const COACH_CHAT_RULES = [
  'You are a friendly chess coach helping a beginner–club player.',
  'You are coaching ONE ongoing game. Earlier messages may be tips for OLDER positions.',
  'CRITICAL: The CURRENT FEN and POSITION FACTS below are authoritative. Ignore piece placement from earlier turns if it conflicts.',
  'Answer the question he asks. Questions about the other side are allowed. Do not refuse.',
  'If POSITION FACTS say a castling side is legal or illegal, trust that—do not invent blockers.',
  'Any move you name as playable in this position must be copied from LEGAL MOVES (SAN). If a move is not on that list, do not suggest it.',
  'You may still name a move you are only explaining, including the move he played and a reply by the other side.',
  'If he asks about a move that is not legal SAN, such as “nx2”, answer in words and name the real square (such as f2). Keep his word in the reply.',
  'You may describe the other side’s plan in plain words (pieces, files, threats) even when it is not their turn.',
  'When he asks what to play on this move, prefer the ENGINE BEST MOVE if that move is in LEGAL MOVES.',
  'Plain English, 2–5 short sentences. No JSON, no markdown fences, no bullet lists unless the player asks for a list.',
  'Do not greet or restate the full tips unless asked.',
].join('\n')

/** Ground-truth facts so follow-ups don’t rely on stale chat memory. */
function positionFacts(fen: string): string {
  try {
    const chess = new Chess(fen)
    const parts = fen.trim().split(/\s+/)
    const side = parts[1] === 'b' ? 'Black' : 'White'
    const rights = parts[2] ?? '-'
    const legal = chess.moves({ verbose: true })
    const sans = legal.map((m) => m.san)
    const oo = legal.find((m) => m.flags.includes('k'))
    const ooo = legal.find((m) => m.flags.includes('q'))
    const castlingLine =
      oo || ooo
        ? [
            oo ? `Kingside O-O is LEGAL (${oo.from}→${oo.to}).` : 'Kingside O-O is NOT legal.',
            ooo
              ? `Queenside O-O-O is LEGAL (${ooo.from}→${ooo.to}).`
              : 'Queenside O-O-O is NOT legal.',
          ].join(' ')
        : 'No castling moves are legal for the side to move.'
    const legalLine =
      sans.length > 0
        ? `LEGAL MOVES (SAN). A move you suggest as playable now must be copied from this list and no other: ${sans.join(', ')}.`
        : 'LEGAL MOVES (SAN): none. Do not suggest a move.'
    return [
      `Side to move: ${side}.`,
      `Castling rights in FEN: ${rights}`,
      castlingLine,
      legalLine,
    ].join('\n')
  } catch {
    return 'Position facts unavailable (invalid FEN).'
  }
}

type LegalIndex = { san: Set<string>; uci: Set<string> }

function sanKey(token: string): string {
  let key = token.trim().replace(/[+#]/g, '')
  if (/^(?:o|0)-/i.test(key)) {
    return key.replace(/0/g, 'O').replace(/o/gi, 'O')
  }
  key = key.replace(/=([kqrbn])/i, (_, piece: string) => `=${piece.toUpperCase()}`)
  if (/^[kqrbn]/i.test(key)) {
    key = key[0].toUpperCase() + key.slice(1).replace(/[A-H]/g, (file) => file.toLowerCase())
  }
  return key
}

function legalIndex(fen: string): LegalIndex | null {
  try {
    const chess = new Chess(fen)
    const san = new Set<string>()
    const uci = new Set<string>()
    for (const move of chess.moves({ verbose: true })) {
      san.add(sanKey(move.san))
      uci.add(`${move.from}${move.to}${move.promotion ?? ''}`.toLowerCase())
    }
    return { san, uci }
  } catch {
    return null
  }
}

/**
 * A bare recommendation: “Play Na4”, “Try e2e5”.
 * “If you play Nxf2” is an explanation, so the lookbehind leaves that name in the sentence.
 * The check or mate mark stays on the token. A trailing word-boundary used to stop before “+”,
 * which turned **Ng1+** into **+**.
 */
const RECOMMENDED_MOVE =
  /(?<!\bif\s+\w+\s+)\b(play|playing|try|trying|consider|prefer|push|pushes|pushing)\s+(O-O-O|0-0-0|O-O|0-0|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[KQRBN])?|[a-h]x[a-h][1-8](?:=[KQRBN])?|[a-h][18]=[KQRBN]|[a-h][1-8][a-h][1-8][qrbn]?|[a-h][1-8])([+#])?/gi

function moveIsLegal(index: LegalIndex, token: string): boolean {
  if (index.uci.has(token.toLowerCase())) return true
  return index.san.has(sanKey(token))
}

/** Quotes and bold are names being discussed. Put them aside so the filter cannot empty them. */
function holdDiscussedSpellings(text: string): { text: string; held: string[] } {
  const held: string[] = []
  const shield = (chunk: string) => {
    held.push(chunk)
    return `\u0000${held.length - 1}\u0000`
  }
  return {
    held,
    text: text
      .replace(/\*\*[^*]*\*\*/g, shield)
      .replace(/“[^”]*”/g, shield)
      .replace(/"[^"]*"/g, shield),
  }
}

function tidyMoveGaps(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .trim()
}

/**
 * Drop a move only when the coach tells the player to play it and chess.js says
 * that move is illegal in this FEN. Discussed names stay, including the move the
 * player wrote, a quoted “nx2”, and bold **Ng1+**.
 */
export function dropIllegalSuggestions(fen: string, raw: string): string {
  const index = legalIndex(fen)
  if (!index) return raw

  const scrub = (text: string) => {
    const { text: shielded, held } = holdDiscussedSpellings(text)
    RECOMMENDED_MOVE.lastIndex = 0
    const stripped = shielded.replace(
      RECOMMENDED_MOVE,
      (match, verb: string, token: string) => {
        if (moveIsLegal(index, token)) return match
        return `${verb} `
      },
    )
    return tidyMoveGaps(
      stripped.replace(/\u0000(\d+)\u0000/g, (_, n) => held[Number(n)] ?? ''),
    )
  }

  const match = raw.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { explanation?: unknown }
      if (parsed && typeof parsed.explanation === 'string') {
        parsed.explanation = scrub(parsed.explanation)
        return raw.replace(match[0], JSON.stringify(parsed))
      }
    } catch {
      /* The reply is prose, not a coach card. */
    }
  }
  return scrub(raw)
}

function describeMover(fen: string, from: string, to: string): string {
  try {
    const chess = new Chess(fen)
    const piece = chess.get(from as Parameters<Chess['get']>[0])
    if (!piece) return `No piece on ${from} (bad option).`
    const color = piece.color === 'w' ? 'White' : 'Black'
    const names: Record<string, string> = {
      p: 'pawn',
      n: 'knight',
      b: 'bishop',
      r: 'rook',
      q: 'queen',
      k: 'king',
    }
    const name = names[piece.type] ?? piece.type
    const side = fen.trim().split(/\s+/)[1] === 'b' ? 'Black' : 'White'
    const ok = color === side ? 'matches side to move' : 'WARNING: does NOT match side to move'
    return `Moving piece: ${color} ${name} on ${from} → ${to} (${ok}).`
  } catch {
    return `Moving piece: unknown (${from} → ${to}).`
  }
}

function readBody(req: import('http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function buildPrompt(body: ExplainRequest, openingBrief?: string): string {
  const side = body.fen.trim().split(/\s+/)[1] === 'b' ? 'Black' : 'White'
  const optionBlocks = body.options.map((opt, i) =>
    [
      `--- ENGINE OPTION ${i + 1} of ${body.options.length} (${side} to play) ---`,
      `ENGINE MOVE: ${opt.bestMove}`,
      describeMover(body.fen, opt.from, opt.to),
      `From square: ${opt.from}`,
      `To square: ${opt.to}`,
      `Engine eval: ${opt.evalLabel}`,
      `Principal variation: ${opt.line}`,
    ].join('\n'),
  )

  return [
    COACH_RULES,
    '',
    openingBrief
      ? [
          '--- Opening practice context (use lightly; still coach THIS move) ---',
          openingBrief,
          '',
        ].join('\n')
      : null,
    '--- Current position (same game as prior tips in this chat) ---',
    body.plyHint ? `Progress: ${body.plyHint}` : null,
    `FEN: ${body.fen}`,
    positionFacts(body.fen),
    `YOU ARE COACHING: ${side}. Explain for ${side}'s move now.`,
    `Number of ENGINE OPTIONS: ${body.options.length}`,
    body.options.length > 1
      ? `Recommend option 1 and briefly compare the alternatives using evals.`
      : 'Only one engine option — explain that move.',
    '',
    ...optionBlocks,
  ]
    .filter(Boolean)
    .join('\n')
}

function percent(count: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((count / total) * 100)
}

/**
 * Win rates for the first two moves, from the explorer at this player's Elo band.
 * The model is told to quote these numbers and not invent its own.
 */
async function reviewOpeningFacts(body: ReviewRequest): Promise<string> {
  const first = body.plies.slice(0, 2)
  const startFen = first[0]?.fen
  if (!startFen) return 'Opening stats: unavailable. Do not invent a win rate.'

  const chess = new Chess(startFen)
  const uci: string[] = []
  for (const ply of first) {
    let played: { from: string; to: string; promotion?: string } | null = null
    try {
      played = chess.move(ply.san)
    } catch {
      played = null
    }
    if (!played) break
    uci.push(`${played.from}${played.to}${played.promotion ?? ''}`)
  }
  if (uci.length === 0) return 'Opening stats: unavailable. Do not invent a win rate.'

  const elo =
    typeof body.playerElo === 'number' && Number.isFinite(body.playerElo)
      ? Math.round(body.playerElo)
      : null
  const band = elo != null ? ratingBandForElo(elo) : null
  const ratings = band ? [band] : allRatingBands()

  let position: Awaited<ReturnType<typeof queryExplorerPosition>>
  try {
    position = await queryExplorerPosition(startFen, ratings, uci.join(','))
  } catch {
    return 'Opening stats: unavailable. Do not invent a win rate.'
  }

  const total = position.white + position.draws + position.black
  if (total <= 0) {
    return 'Opening stats: no games in this rating band. Do not invent a win rate.'
  }

  const youWins = body.playerColor === 'white' ? position.white : position.black
  const oppWins = body.playerColor === 'white' ? position.black : position.white
  const youPct = percent(youWins, total)
  const drawPct = percent(position.draws, total)
  const oppPct = percent(oppWins, total)
  const edge =
    youWins > oppWins
      ? 'You win more often than the opponent from here, so this is a practical edge.'
      : youWins < oppWins
        ? 'The opponent wins more often from here.'
        : 'Wins are about even from here.'

  const playerPly = first.find((ply) => ply.by === 'player')
  const evalText = playerPly?.playedEval?.trim()
  const evalNumber = evalText ? Number(evalText) : NaN
  const whiteIsBetter = Number.isFinite(evalNumber)
    ? evalNumber > 0.15
    : evalText?.startsWith('M') === true
  const blackIsBetter = Number.isFinite(evalNumber)
    ? evalNumber < -0.15
    : evalText?.startsWith('-') === true
  const engineDisadvantage =
    (body.playerColor === 'white' && blackIsBetter) ||
    (body.playerColor === 'black' && whiteIsBetter)
  const engine = !evalText || evalText === '—'
    ? 'Stockfish eval for these moves: not recorded. Do not claim the engine dislikes the opening.'
    : engineDisadvantage
      ? `Stockfish eval is ${evalText} from White's side after your early move. You are ${body.playerColor === 'white' ? 'White' : 'Black'}, so this is a disadvantage for you. Mention that only as a contrast with the win rate. Do not call the opening a mistake.`
      : `Stockfish eval is ${evalText} from White's side after your early move. You are ${body.playerColor === 'white' ? 'White' : 'Black'}. Do not criticize the opening.`

  const name = position.opening?.name?.trim()
  return [
    'OPENING FACTS for the first two moves. Quote these numbers. Do not invent a percentage or an opening name.',
    elo != null && band
      ? `Rating band: ${ratingBandRangeLabel(band)} (player Elo ${elo}).`
      : 'Rating band: all ratings combined (this game had no Elo).',
    name ? `Opening name: ${name}.` : 'Opening name: none. Say “these first two moves”.',
    `You win ${youPct}%, draws ${drawPct}%, opponent wins ${oppPct}% (${total} games). ${edge}`,
    engine,
  ].join('\n')
}

export function buildReviewPrompt(body: ReviewRequest, openingFacts: string): string {
  const you = body.playerColor === 'white' ? 'White' : 'Black'
  const plyLines = body.plies.map((p) => {
    const who = p.by === 'player' ? `YOU (${you})` : 'OPPONENT'
    const tag = p.tag ? ` [${p.tag}]` : ''
    const best =
      p.bestSan && p.tag && p.tag !== 'best'
        ? ` best was ${p.bestSan} (${p.bestEval ?? '—'})`
        : ''
    const evals = p.playedEval ? ` eval ${p.playedEval}` : ''
    return `${p.ply}. ${who} ${p.san}${tag}${evals}${best} | ${p.fen}`
  })

  return [
    'You are a friendly chess coach helping a beginner–club player review a finished game.',
    reviewCoachVoice(body.playerColor),
    `You are coaching ${you} (the human). “You” means ${you} for this whole review. Describe the opponent as “they”. Do not refuse to say what they did.`,
    'The move list and FENs below are ground truth for YOU only — do not invent what happened.',
    'CRITICAL — the player cannot replay move numbers yet. Do NOT cite move numbers, SAN, or UCI',
    '(no “7.Qe1”, no “1.b3”, no “Nxg6”). Talk in ideas a beginner can picture on the board:',
    'pieces, files, king safety, pawn weaknesses, development, checks, captures, hanging pieces.',
    'You may say “early on”, “later”, “the finishing blow” — not ply indices.',
    'Write at most 3 short sentences. Never write a fourth. Plain English. No markdown headings or bullet lists.',
    'Sentence 1, say this first: the single biggest room for improvement, and the habit that builds it.',
    'Use the worst tagged mistake or blunder after the opening. Describe what went wrong and the safer habit (checks, captures, hanging pieces, king safety).',
    'Sentence 2: the first two moves only, using OPENING FACTS. Name the opening when one is given.',
    'State the win rate for their rating band. If the facts say you win more often even though Stockfish shows a disadvantage, say the opening is solid for their rating and still gives a practical edge.',
    'If the facts say the opponent wins more often, say that in the same sentence and move on. Do not explain why the opening is dubious.',
    'Do not critique the opening. Do not spend sentence 2 on development, the center, or king safety.',
    'Sentence 3 only if the habit still needs one plainer line. Otherwise stop after sentence 2.',
    'Reply with ONLY a single JSON object (no markdown fences): {"explanation":"..."}',
    '',
    openingFacts,
    '',
    body.outcome === 'unknown'
      ? 'Outcome: not recorded.'
      : `Outcome: ${you} ${body.outcome}.`,
    `You played ${you}.`,
    `Plies: ${body.plies.length}`,
    '',
    '--- Game (ply, who, SAN, quality tag, evals, FEN before the move) ---',
    ...plyLines,
  ].join('\n')
}

function formatOpeningCatalog(entries: OpeningCatalogEntry[]): string {
  return entries
    .map((e, i) => {
      const eco = e.eco?.trim() ? ` (${e.eco.trim()})` : ''
      return `${i + 1}. ${e.name}${eco} [id=${e.id}]\n   ${e.summary}\n   Moves: ${e.moves}`
    })
    .join('\n')
}

function legalEngineLine(
  fen: string,
  line: { uci: string; from: string; to: string; evalLabel: string },
): string | null {
  try {
    const chess = new Chess(fen)
    const promotion = line.uci.length > 4 ? line.uci[4] : undefined
    const played = chess.move({
      from: line.from,
      to: line.to,
      promotion,
    })
    if (!played?.san) return null
    return `${played.san} (${line.from}→${line.to}) eval ${line.evalLabel}`
  } catch {
    return null
  }
}

export function buildChatPrompt(body: CoachChatRequest, openingBrief?: string): string {
  const engineRows = (body.engineLines ?? [])
    .map((line) => legalEngineLine(body.fen, line))
    .filter((line): line is string => Boolean(line))
  const engineBlock =
    engineRows.length > 0
      ? [
          '--- Top engine moves (for this position) ---',
          ...engineRows.map((line, i) => `${i + 1}. ${line}`),
        ].join('\n')
      : null

  const catalog =
    body.openingCatalog && body.openingCatalog.length > 0
      ? [
          '--- Opening drills this player practices in the app (use when relevant) ---',
          'These are the concrete lines they study. Relate advice to them when asked about openings / Italian / drills.',
          formatOpeningCatalog(body.openingCatalog),
          '',
        ].join('\n')
      : null

  const human =
    body.playerColor === 'white' || body.playerColor === 'black'
      ? body.playerColor
      : null
  const isReview = Boolean(body.reviewBrief?.trim() || human)
  const voice = isReview
    ? [
        '--- Game review context (post-game analysis) ---',
        human
          ? reviewCoachVoice(human)
          : '“You” means the human’s color in this finished game. Answer questions about either side. Do not refuse.',
        'The human’s color does not change when the other side is to move.',
        body.reviewBrief?.trim() || null,
        '',
      ]
        .filter(Boolean)
        .join('\n')
    : [
        '--- Live position ---',
        'Answer whichever side he asks about, White or Black. Do not refuse.',
        'If he does not name a side, “you” means the side to move.',
        '',
      ].join('\n')

  const recentMessages = (body.messages ?? [])
    .filter(
      (message) =>
        (message.role === 'user' || message.role === 'assistant') &&
        message.text?.trim(),
    )
    .slice(-8)
  const conversation =
    recentMessages.length > 0
      ? [
          '--- Recent conversation (oldest to newest) ---',
          ...recentMessages.map(
            (message) =>
              `${message.role === 'user' ? 'Player' : 'Coach'}: ${message.text.trim()}`,
          ),
          '',
        ].join('\n')
      : null

  return [
    COACH_CHAT_RULES,
    '',
    openingBrief
      ? [
          '--- Opening practice context (use lightly) ---',
          openingBrief,
          '',
        ].join('\n')
      : null,
    catalog,
    voice,
    conversation,
    '--- Current position (authoritative) ---',
    `FEN: ${body.fen}`,
    positionFacts(body.fen),
    body.bestMove
      ? `ENGINE BEST MOVE (selected/option 1 focus): ${body.bestMove}. Prefer it only when that move is in LEGAL MOVES.`
      : null,
    body.evalLabel
      ? human
        ? `Engine eval ${body.evalLabel} is from White's side. The human is ${human === 'white' ? 'White' : 'Black'}.`
        : `Engine eval: ${body.evalLabel}`
      : null,
    engineBlock,
    body.explanation
      ? [
          '--- Coach card already shown to the player ---',
          body.explanation,
        ].join('\n')
      : null,
    '',
    `Player question: ${body.question.trim()}`,
  ]
    .filter(Boolean)
    .join('\n')
}

async function openingBriefFor(lineId?: string): Promise<string | undefined> {
  if (!lineId?.trim()) return undefined
  try {
    const { formatOpeningCardForCoach, getCachedOpeningCard } =
      await import('./openingCards.js')
    const card = await getCachedOpeningCard(lineId.trim())
    if (!card) return undefined
    return formatOpeningCardForCoach(card)
  } catch (err) {
    console.warn('[opening-cards] brief load failed:', err)
    return undefined
  }
}

function explorerFailureStatus(message: string): number {
  if (message.includes('busy')) return 503
  if (message.includes('too long')) return 504
  if (message.includes('offline')) return 502
  return 500
}

/**
 * Lichess stores a Stockfish result for common positions. We turn their
 * first move (a square code like e2e4) into normal notation (e4).
 * A 404 means that position was never stored under this exact FEN. Clocks
 * are not part of the position, so a bogus fullmove (an opening exported as
 * move 69) is retried as move 1, then the explorer's saved engine move.
 */
function fenWithOpeningClocks(fen: string): string | null {
  const parts = fen.trim().split(/\s+/)
  if (parts.length < 6) return null
  if (parts[4] === '0' && parts[5] === '1') return null
  parts[4] = '0'
  parts[5] = '1'
  return parts.join(' ')
}

async function lichessCloudMove(
  chess: Chess,
  fen: string,
): Promise<{ san: string; uci: string } | null> {
  const endpoint = new URL('https://lichess.org/api/cloud-eval')
  endpoint.searchParams.set('fen', fen)
  endpoint.searchParams.set('multiPv', '1')
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'chess-3d/drill (cloud eval)',
    },
    signal: AbortSignal.timeout(8000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`cloud eval ${response.status}`)
  const body = (await response.json()) as { pvs?: Array<{ moves?: string }> }
  const uci = body.pvs?.[0]?.moves?.split(/\s+/)[0] ?? ''
  if (uci.length < 4) return null
  const played = chess.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  })
  if (!played) return null
  return { san: played.san, uci }
}

function whiteScore(move: {
  engineCp: number | null
  engineMate: number | null
}): number | null {
  const mate = move.engineMate
  if (mate !== null && mate !== 0) {
    return mate > 0 ? 1_000_000 - mate : -1_000_000 - mate
  }
  return move.engineCp
}

/** Saved explorer-engine move when Lichess has no cloud eval for this board. */
async function explorerEngineMove(
  fen: string,
): Promise<{ san: string; uci: string } | null> {
  try {
    const chess = new Chess(fen)
    const position = await queryExplorerPosition(fen, allRatingBands())
    const side = chess.turn() === 'b' ? 'black' : 'white'
    let best: { san: string; uci: string } | null = null
    let bestScore = 0
    for (const move of position.moves) {
      const score = whiteScore(move)
      if (score === null || !move.san || !move.uci) continue
      if (!best) {
        best = { san: move.san, uci: move.uci }
        bestScore = score
        continue
      }
      const better = side === 'white' ? score > bestScore : score < bestScore
      if (better) {
        best = { san: move.san, uci: move.uci }
        bestScore = score
      }
    }
    return best
  } catch (err) {
    console.warn('[cloud-eval] explorer fallback failed:', err)
    return null
  }
}

async function cloudBestMove(fen: string): Promise<{ san: string; uci: string } | null> {
  let chess: Chess
  try {
    chess = new Chess(fen)
  } catch {
    throw new Error('bad fen')
  }
  const canonical = chess.fen()
  const direct = await lichessCloudMove(chess, canonical)
  if (direct) return direct
  const reset = fenWithOpeningClocks(canonical)
  if (reset) {
    const retry = await lichessCloudMove(new Chess(reset), reset)
    if (retry) return retry
  }
  return explorerEngineMove(canonical)
}

function sendJson(
  res: import('http').ServerResponse,
  status: number,
  body: unknown,
) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const CHESSCOM_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?chess\.com\/game\/(live|daily)\/(\d+)/i

type ChessComSeat = { username?: string; color?: string }

type ChessComCallbackPayload = {
  game?: Record<string, unknown> & {
    pgnHeaders?: Record<string, string>
    endTime?: number
    end_time?: number
    white?: { username?: string }
    black?: { username?: string }
  }
  players?: {
    top?: ChessComSeat
    bottom?: ChessComSeat
  }
}

type ChessComArchiveGame = {
  url?: string
  pgn?: string
}

async function fetchJson(url: string): Promise<unknown> {
  let last: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          // Chess.com rejects requests with no contact-style user agent.
          'User-Agent': 'learn-chess/1.0 (game import)',
        },
        signal: AbortSignal.timeout(20000),
      })
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`Chess.com returned ${res.status}`)
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
        continue
      }
      if (!res.ok) {
        throw new Error(`Chess.com returned ${res.status}`)
      }
      return await res.json()
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.startsWith('Chess.com returned') &&
        !err.message.includes('429') &&
        !/Chess\.com returned 5\d\d/.test(err.message)
      ) {
        throw err
      }
      const message = err instanceof Error ? err.message : String(err)
      const cause =
        err instanceof Error && err.cause instanceof Error ? err.cause.message : ''
      last = new Error(cause ? `${message}: ${cause}` : message)
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
      }
    }
  }
  throw last ?? new Error('Chess.com request failed')
}

type OpeningReplyMove = {
  san: string
  count: number
  wins: number
  draws: number
  losses: number
}

type CachedChessComGame = {
  sans: string[]
  white: string
  black: string
  result: string
}

const chessComGameCache = new Map<string, { at: number; games: CachedChessComGame[] }>()
const CHESSCOM_CACHE_MS = 10 * 60 * 1000

function recentChessComMonths(count: number): Array<{ yyyy: string; mm: string }> {
  const out: Array<{ yyyy: string; mm: string }> = []
  const d = new Date()
  for (let i = 0; i < count; i++) {
    const cursor = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))
    out.push({
      yyyy: String(cursor.getUTCFullYear()),
      mm: String(cursor.getUTCMonth() + 1).padStart(2, '0'),
    })
  }
  return out
}

function userResult(
  game: CachedChessComGame,
  username: string,
): 'win' | 'draw' | 'loss' | null {
  const me = username.toLowerCase()
  const side =
    game.white.toLowerCase() === me
      ? 'white'
      : game.black.toLowerCase() === me
        ? 'black'
        : null
  if (!side) return null
  if (game.result === '1/2-1/2') return 'draw'
  if (game.result === '1-0') return side === 'white' ? 'win' : 'loss'
  if (game.result === '0-1') return side === 'black' ? 'win' : 'loss'
  return null
}

/** Most common next moves in this player's recent chess.com games. */
async function openingRepliesFor(
  username: string,
  prefix: string[],
): Promise<{ scanned: number; reached: number; moves: OpeningReplyMove[] }> {
  const user = username.trim().toLowerCase()
  if (!user || !/^[a-z0-9_-]{2,25}$/i.test(username.trim())) {
    throw new Error('Enter a chess.com username')
  }

  const cached = chessComGameCache.get(user)
  let games = cached && Date.now() - cached.at < CHESSCOM_CACHE_MS ? cached.games : null
  if (!games) {
    const loaded: CachedChessComGame[] = []
    for (const { yyyy, mm } of recentChessComMonths(3)) {
      let archive: { games?: Array<{ pgn?: string }> }
      try {
        archive = (await fetchJson(
          `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/${yyyy}/${mm}`,
        )) as { games?: Array<{ pgn?: string }> }
      } catch {
        continue
      }
      const monthGames = archive.games ?? []
      const recent = monthGames.slice(-120)
      for (const g of recent) {
        if (!g.pgn) continue
        try {
          const chess = new Chess()
          chess.loadPgn(g.pgn)
          const headers = chess.getHeaders()
          loaded.push({
            sans: chess.history(),
            white: headers.White ?? '',
            black: headers.Black ?? '',
            result: headers.Result ?? '*',
          })
        } catch {
          // Skip unreadable PGNs.
        }
      }
    }
    games = loaded
    chessComGameCache.set(user, { at: Date.now(), games })
  }

  const counts = new Map<string, OpeningReplyMove>()
  let reached = 0
  for (const game of games) {
    if (prefix.length > game.sans.length) continue
    if (!prefix.every((san, i) => game.sans[i] === san)) continue
    const next = game.sans[prefix.length]
    if (!next) continue
    reached += 1
    const row = counts.get(next) ?? {
      san: next,
      count: 0,
      wins: 0,
      draws: 0,
      losses: 0,
    }
    row.count += 1
    const outcome = userResult(game, user)
    if (outcome === 'win') row.wins += 1
    else if (outcome === 'draw') row.draws += 1
    else if (outcome === 'loss') row.losses += 1
    counts.set(next, row)
  }

  const moves = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.san.localeCompare(b.san))
    .slice(0, 8)

  return { scanned: games.length, reached, moves }
}

async function latestChessComPgn(username: string): Promise<{
  pgn: string
  playerColor: PlayerSide | null
}> {
  const user = username.trim().toLowerCase()
  if (!user || !/^[a-z0-9_-]{2,25}$/i.test(username.trim())) {
    throw new Error('Enter a chess.com username')
  }

  // The archive list is tiny. It names the real months this player has games,
  // so we download one month instead of guessing and swallowing failures.
  let listed: { archives?: string[] }
  try {
    listed = (await fetchJson(
      `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`,
    )) as { archives?: string[] }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chess.com request failed'
    if (message.includes('404')) {
      throw new Error('No chess.com player with that username')
    }
    throw new Error(`Could not reach chess.com (${message})`)
  }

  const months = listed.archives ?? []
  if (months.length === 0) throw new Error('No chess.com games for that username')

  let lastErr: Error | null = null
  const stop = Math.max(0, months.length - 3)
  for (let i = months.length - 1; i >= stop; i--) {
    try {
      const archive = (await fetchJson(months[i])) as {
        games?: Array<{
          pgn?: string
          end_time?: number
          white?: { username?: string }
          black?: { username?: string }
        }>
      }
      let best: {
        pgn: string
        endTime: number
        playerColor: PlayerSide | null
      } | null = null
      for (const game of archive.games ?? []) {
        const pgn = game.pgn?.trim()
        if (!pgn) continue
        const endTime = game.end_time ?? 0
        if (!best || endTime >= best.endTime) {
          best = {
            pgn,
            endTime,
            // Account usernames, not the PGN text. This is the side they played.
            playerColor: sideForUsername(
              game.white?.username,
              game.black?.username,
              user,
            ),
          }
        }
      }
      if (best) return { pgn: best.pgn, playerColor: best.playerColor }
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
    }
  }

  throw (
    lastErr ?? new Error('No recent chess.com games for that username')
  )
}

function chessComMonthFromUnix(sec: number): { yyyy: string; mm: string } {
  const d = new Date(sec * 1000)
  return {
    yyyy: String(d.getUTCFullYear()),
    mm: String(d.getUTCMonth() + 1).padStart(2, '0'),
  }
}

function seatUsername(
  payload: ChessComCallbackPayload,
  color: PlayerSide,
): string | null {
  const seats = [payload.players?.top, payload.players?.bottom]
  for (const seat of seats) {
    if (seat?.color === color && seat.username?.trim()) return seat.username.trim()
  }
  const header =
    color === 'white'
      ? payload.game?.pgnHeaders?.White
      : payload.game?.pgnHeaders?.Black
  if (typeof header === 'string' && header.trim() && header.trim() !== '?') {
    return header.trim()
  }
  const direct =
    color === 'white'
      ? payload.game?.white?.username
      : payload.game?.black?.username
  return direct?.trim() || null
}

async function importChessComPgn(
  urlOrId: string,
  username?: string,
): Promise<{
  pgn: string
  white: string | null
  black: string | null
  playerColor: PlayerSide | null
  gameUrl: string
}> {
  const m = urlOrId.trim().match(CHESSCOM_URL_RE)
  if (!m) {
    throw new Error(
      'Expected a chess.com game URL like https://www.chess.com/game/live/123',
    )
  }
  const type = m[1].toLowerCase() as 'live' | 'daily'
  const id = m[2]
  const gameUrl = `https://www.chess.com/game/${type}/${id}`

  const raw = (await fetchJson(
    `https://www.chess.com/callback/${type}/game/${id}`,
  )) as ChessComCallbackPayload
  const game = raw.game
  if (!game) throw new Error('chess.com returned no game data')

  // `players.bottom` is whoever chess.com drew at the bottom, not always White.
  const white = seatUsername(raw, 'white')
  const black = seatUsername(raw, 'black')

  let endSec =
    typeof game.end_time === 'number'
      ? game.end_time
      : typeof game.endTime === 'number'
        ? game.endTime
        : null
  if (endSec != null && endSec > 1e12) endSec = Math.floor(endSec / 1000)

  const usernames = [white, black].filter(Boolean) as string[]
  if (usernames.length === 0) {
    throw new Error('Could not resolve players for this chess.com game')
  }

  const months: Array<{ yyyy: string; mm: string }> = []
  if (endSec != null) months.push(chessComMonthFromUnix(endSec))
  else {
    const now = new Date()
    months.push({
      yyyy: String(now.getUTCFullYear()),
      mm: String(now.getUTCMonth() + 1).padStart(2, '0'),
    })
  }

  let pgn: string | null = null
  let lastErr: Error | null = null
  for (const user of usernames) {
    for (const { yyyy, mm } of months) {
      try {
        const archive = (await fetchJson(
          `https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/${yyyy}/${mm}`,
        )) as { games?: ChessComArchiveGame[] }
        const match = (archive.games ?? []).find((g) => {
          const u = g.url ?? ''
          return u.endsWith(`/${id}`) || u.includes(`/game/${type}/${id}`)
        })
        if (match?.pgn) {
          pgn = match.pgn
          break
        }
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err))
      }
    }
    if (pgn) break
  }

  if (!pgn) {
    throw (
      lastErr ??
      new Error(
        'PGN not found in chess.com monthly archive yet — try again later or paste the PGN',
      )
    )
  }

  return {
    pgn,
    white,
    black,
    playerColor: sideForUsername(white, black, username),
    gameUrl,
  }
}

/** Shared Node handler used by Vite locally and Vercel Functions in production. */
export async function handleExplainApi(
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
  next: () => void = () => {},
): Promise<void> {
        const url = req.url?.split('?')[0] ?? ''

        if (url === '/api/game-id' && req.method === 'POST') {
          sendJson(res, 200, { gameId: randomUUID() })
          return
        }

        if (url === '/api/import-chesscom-latest') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end('Method not allowed')
            return
          }
          try {
            const rawBody = await readBody(req)
            const body = JSON.parse(rawBody || '{}') as { username?: string }
            const result = await latestChessComPgn(body.username ?? '')
            sendJson(res, 200, result)
          } catch (err) {
            sendJson(res, 404, {
              error:
                err instanceof Error ? err.message : 'latest game lookup failed',
            })
          }
          return
        }

        if (url === '/api/opening-replies') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end('Method not allowed')
            return
          }
          try {
            const rawBody = await readBody(req)
            const body = JSON.parse(rawBody || '{}') as {
              username?: string
              moves?: string[]
            }
            const moves = Array.isArray(body.moves)
              ? body.moves.filter((m) => typeof m === 'string').slice(0, 40)
              : []
            const result = await openingRepliesFor(body.username ?? '', moves)
            sendJson(res, 200, result)
          } catch (err) {
            sendJson(res, 400, {
              error: err instanceof Error ? err.message : 'opening replies failed',
            })
          }
          return
        }

        if (url === '/api/explore-cache') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method not allowed')
            return
          }
          const secret = process.env.CRON_SECRET?.trim()
          if (secret) {
            const header = req.headers.authorization
            const auth = Array.isArray(header) ? header[0] : header
            if (auth !== `Bearer ${secret}`) {
              sendJson(res, 401, { error: 'cron unauthorized' })
              return
            }
          }
          try {
            const deleted = await purgeExpiredExplorerBranches()
            sendJson(res, 200, { deleted })
          } catch (err) {
            sendJson(res, 500, {
              error: err instanceof Error ? err.message : 'cache cleanup failed',
            })
          }
          return
        }

        if (url === '/api/opening-defenses') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method not allowed')
            return
          }
          const parsed = readExplorerQuery(req.url)
          if ('error' in parsed) {
            sendJson(res, 400, { error: parsed.error })
            return
          }
          const controller = new AbortController()
          const onClose = () => controller.abort()
          req.on('close', onClose)
          try {
            const defenses = await loadBlackDefenses(
              parsed.ratings,
              controller.signal,
              parsed.speeds,
            )
            sendJson(res, 200, defenses)
          } catch (err) {
            if (controller.signal.aborted) return
            const message =
              err instanceof Error ? err.message : 'opening defenses failed'
            sendJson(res, 500, { error: message })
          } finally {
            req.off('close', onClose)
          }
          return
        }

        if (url === '/api/opening-branch') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method not allowed')
            return
          }
          const parsed = readExplorerQuery(req.url)
          if ('error' in parsed) {
            sendJson(res, 400, { error: parsed.error })
            return
          }
          if (!parsed.options.play) {
            sendJson(res, 400, { error: 'play is required' })
            return
          }
          const controller = new AbortController()
          const onClose = () => controller.abort()
          req.on('close', onClose)
          try {
            const branch = await loadOpeningBranch(
              parsed.fen,
              parsed.ratings,
              parsed.options.play,
              controller.signal,
              parsed.speeds,
            )
            sendJson(res, 200, branch)
          } catch (err) {
            if (controller.signal.aborted) return
            const message =
              err instanceof Error ? err.message : 'opening branch failed'
            sendJson(res, 500, { error: message })
          } finally {
            req.off('close', onClose)
          }
          return
        }

        const cloudEval =
          url === '/api/cloud-eval' ||
          (url === '/api/opening-explorer' &&
            new URL(req.url ?? '', 'http://localhost').searchParams.get('view') === 'cloud-eval')
        if (cloudEval) {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method not allowed')
            return
          }
          const fen = new URL(req.url ?? '', 'http://localhost').searchParams.get('fen')?.trim() ?? ''
          if (!fen) {
            sendJson(res, 400, { error: 'fen required' })
            return
          }
          try {
            const best = await cloudBestMove(fen)
            if (!best) {
              sendJson(res, 404, { error: 'not in cloud' })
              return
            }
            sendJson(res, 200, best)
          } catch (err) {
            const message = err instanceof Error ? err.message : 'cloud eval failed'
            sendJson(res, message === 'bad fen' ? 400 : 502, { error: message })
          }
          return
        }

        const monthList =
          url === '/api/explorer-months' ||
          (url === '/api/opening-explorer' &&
            new URL(req.url ?? '', 'http://localhost').searchParams.get('view') === 'months')
        if (monthList) {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method not allowed')
            return
          }
          try {
            const months = await listExplorerMonths()
            sendJson(res, 200, { months })
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'explorer months failed'
            sendJson(res, explorerFailureStatus(message), { error: message })
          }
          return
        }

        if (url === '/api/opening-explorer') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method not allowed')
            return
          }
          const parsed = readExplorerQuery(req.url)
          if ('error' in parsed) {
            sendJson(res, 400, { error: parsed.error })
            return
          }
          const controller = new AbortController()
          const onClose = () => controller.abort()
          req.on('close', onClose)
          try {
            const position = await queryExplorerPosition(
              parsed.fen,
              parsed.ratings,
              parsed.options.play ?? '',
              parsed.speeds,
              parsed.months,
            )
            sendJson(res, 200, position)
          } catch (err) {
            if (controller.signal.aborted) return
            const message =
              err instanceof Error ? err.message : 'opening explorer failed'
            sendJson(res, explorerFailureStatus(message), { error: message })
          } finally {
            req.off('close', onClose)
          }
          return
        }

        if (url === '/api/import-chesscom') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end('Method not allowed')
            return
          }
          try {
            const rawBody = await readBody(req)
            const body = JSON.parse(rawBody || '{}') as {
              url?: string
              username?: string
            }
            if (!body.url?.trim()) {
              sendJson(res, 400, { error: 'url required' })
              return
            }
            const result = await importChessComPgn(body.url, body.username)
            sendJson(res, 200, result)
          } catch (err) {
            sendJson(res, 502, {
              error:
                err instanceof Error
                  ? err.message
                  : 'chess.com import failed',
            })
          }
          return
        }

        if (url === '/api/opening-card') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end('Method not allowed')
            return
          }
          try {
            const rawBody = await readBody(req)
            const body = JSON.parse(rawBody || '{}') as {
              line?: OpeningLineInput
              lineId?: string
            }
            const line = body.line
            if (
              !line?.id?.trim() ||
              !line.name?.trim() ||
              !Array.isArray(line.moves) ||
              line.moves.length === 0
            ) {
              sendJson(res, 400, {
                error: 'line { id, name, summary, moves[{san}] } required',
              })
              return
            }
            const { getOrCreateOpeningCard } =
              await import('./openingCards.js')
            const card = await getOrCreateOpeningCard({
              id: line.id,
              name: line.name,
              eco: line.eco,
              summary: line.summary ?? '',
              moves: line.moves,
            })
            sendJson(res, 200, card)
          } catch (err) {
            sendJson(res, 500, {
              error:
                err instanceof Error
                  ? err.message
                  : 'opening-card failed',
            })
          }
          return
        }

        const isExplain = url.startsWith('/api/explain')
        const isCoachChat = url.startsWith('/api/coach-chat')
        const isReview = url.startsWith('/api/review')
        if (!isExplain && !isCoachChat && !isReview) return next()

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        let cancel: (() => void) | undefined

        try {
          const raw = await readBody(req)

          if (isCoachChat) {
            const body = JSON.parse(raw) as CoachChatRequest
            if (!body.gameId || !body.fen || !body.question?.trim()) {
              sendJson(res, 400, {
                error: 'gameId, fen, and question required',
              })
              return
            }

            const openingBrief = await openingBriefFor(body.openingLineId)

            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
              'X-Explain-Model': EXPLAIN_MODEL,
              'X-Game-Id': body.gameId,
            })

            const send = (payload: unknown) => {
              res.write(`data: ${JSON.stringify(payload)}\n\n`)
            }

            send({ type: 'model', model: EXPLAIN_MODEL, gameId: body.gameId })

            const stream = streamCoachAsk(
              buildChatPrompt(body, openingBrief),
              (text) => send({ type: 'delta', text }),
              (fullText) => {
                send({
                  type: 'done',
                  text: dropIllegalSuggestions(body.fen, fullText),
                })
                res.end()
              },
              (err) => {
                send({ type: 'error', error: err.message })
                res.end()
              },
            )
            cancel = stream.cancel

            res.on('close', () => {
              if (!res.writableEnded) cancel?.()
            })
            await stream.done
            return
          }

          if (isReview) {
            const body = JSON.parse(raw) as ReviewRequest
            if (
              !body.gameId ||
              (body.playerColor !== 'white' && body.playerColor !== 'black') ||
              !['win', 'loss', 'draw', 'unknown'].includes(body.outcome) ||
              !Array.isArray(body.plies) ||
              body.plies.length === 0
            ) {
              sendJson(res, 400, {
                error: 'gameId, playerColor, outcome, and plies required',
              })
              return
            }

            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
              'X-Explain-Model': EXPLAIN_MODEL,
              'X-Game-Id': body.gameId,
            })

            const send = (payload: unknown) => {
              res.write(`data: ${JSON.stringify(payload)}\n\n`)
            }

            send({ type: 'model', model: EXPLAIN_MODEL, gameId: body.gameId })

            const openingFacts = await reviewOpeningFacts(body)
            const stream = streamCoachAsk(
              buildReviewPrompt(body, openingFacts),
              (text) => send({ type: 'delta', text }),
              (fullText) => {
                send({ type: 'done', text: fullText })
                res.end()
              },
              (err) => {
                send({ type: 'error', error: err.message })
                res.end()
              },
            )
            cancel = stream.cancel

            res.on('close', () => {
              if (!res.writableEnded) cancel?.()
            })
            await stream.done
            return
          }

          const body = JSON.parse(raw) as ExplainRequest
          if (
            !body.fen ||
            !body.gameId ||
            !Array.isArray(body.options) ||
            body.options.length === 0 ||
            body.options.some((o) => !o?.bestMove || !o?.from || !o?.to)
          ) {
            sendJson(res, 400, {
              error: 'fen, gameId, and options[{bestMove,from,to,...}] required',
            })
            return
          }

          const openingBrief = await openingBriefFor(body.openingLineId)

          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            'X-Explain-Model': EXPLAIN_MODEL,
            'X-Game-Id': body.gameId,
          })

          const send = (payload: unknown) => {
            res.write(`data: ${JSON.stringify(payload)}\n\n`)
          }

          send({ type: 'model', model: EXPLAIN_MODEL, gameId: body.gameId })

          const stream = streamCoachAsk(
            buildPrompt(body, openingBrief),
            (text) => send({ type: 'delta', text }),
            (fullText) => {
              send({
                type: 'done',
                text: dropIllegalSuggestions(body.fen, fullText),
              })
              res.end()
            },
            (err) => {
              send({ type: 'error', error: err.message })
              res.end()
            },
          )
          cancel = stream.cancel

          res.on('close', () => {
            if (!res.writableEnded) cancel?.()
          })
          await stream.done
        } catch (err) {
          cancel?.()
          if (!res.headersSent) {
            sendJson(res, 500, {
              error: err instanceof Error ? err.message : 'Explain failed',
            })
          } else {
            res.write(
              `data: ${JSON.stringify({
                type: 'error',
                error: err instanceof Error ? err.message : 'Explain failed',
              })}\n\n`,
            )
            res.end()
          }
        }
}

/** Vite development middleware. */
export function explainApiPlugin(): Plugin {
  return {
    name: 'chess-coach-explain-api',
    configureServer(server) {
      server.middlewares.use(handleExplainApi)
    },
  }
}
