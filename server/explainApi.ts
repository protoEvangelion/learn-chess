import { Chess } from 'chess.js'
import { randomUUID } from 'node:crypto'
import type { Plugin } from 'vite'
import {
  EXPLAIN_MODEL,
  streamCoachAsk,
} from './aiCoach.js'
import {
  fetchExplorerWithToken,
  readExplorerQuery,
} from './lichessExplorerProxy.js'
import { loadBlackDefenses, loadOpeningBranch } from './openingBranch.js'
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
  outcome: 'win' | 'loss' | 'draw'
  plies: ReviewPlyPayload[]
}

/** Stable prefix — keep identical across asks for prompt-cache friendliness. */
const COACH_RULES = [
  'You are a friendly chess coach helping a beginner–club player.',
  'You are coaching ONE ongoing game. Earlier messages in this chat are prior tips for earlier positions—use that arc.',
  'Relate new advice to how the game has progressed when useful.',
  '',
  'CRITICAL — SIDE TO MOVE:',
  'Coach ONLY the side to move named in POSITION FACTS (White or Black).',
  'Every sentence must tell THAT side what to do on THIS move.',
  'Never advise the opponent, never describe “Black’s plan” when White is to move (or vice versa).',
  'If earlier chat tips were for the other color, ignore that perspective and coach the current side only.',
  'Speak as “you” to the side to move (e.g. when White to move: “you can…”, not “Black should…”).',
  '',
  'You will receive ONE OR MORE engine move OPTIONS (ranked best → alternatives) for the side to move.',
  'Write ONE short coaching card that:',
  '1) Recommends option 1 (prefer SAN + from→to) and why it fits now,',
  '2) Briefly mentions how options 2/3 compare (or that they are close), using evals when helpful.',
  'UCI moves are long algebraic coordinates only: <from><to>[promotion] (examples: e2e4, e1g1 = castle, e7e8q = promote).',
  'UCI never names the piece; the mover is whatever occupies <from> in the FEN.',
  'If earlier tips in this chat pointed elsewhere, course-correct toward these engine options.',
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
  'CRITICAL: Coach ONLY the side to move in POSITION FACTS—never switch to advising the opponent.',
  'If POSITION FACTS say a castling side is legal or illegal, trust that—do not invent blockers.',
  'Answer the player’s question about this position, the listed engine moves, or any tips already shown.',
  'Stay aligned with the ENGINE BEST MOVE / listed engine lines when discussing what to play—do not push a different move.',
  'Plain English, 2–5 short sentences. No JSON, no markdown fences, no bullet lists unless the player asks for a list.',
  'Do not greet or restate the full tips unless asked.',
].join('\n')

/** Ground-truth facts so follow-ups don’t rely on stale chat memory. */
function positionFacts(fen: string): string {
  try {
    const chess = new Chess(fen)
    const parts = fen.trim().split(/\s+/)
    const side = parts[1] === 'b' ? 'Black' : 'White'
    const opponent = side === 'White' ? 'Black' : 'White'
    const rights = parts[2] ?? '-'
    const legal = chess.moves({ verbose: true })
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
    return [
      `Side to move: ${side} (YOU are coaching ${side} only — do not advise ${opponent}).`,
      `Castling rights in FEN: ${rights}`,
      castlingLine,
    ].join('\n')
  } catch {
    return 'Position facts unavailable (invalid FEN).'
  }
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

function buildReviewPrompt(body: ReviewRequest): string {
  const you = body.playerColor === 'white' ? 'White' : 'Black'
  const plyLines = body.plies.map((p) => {
    const who = p.by === 'player' ? 'YOU' : 'opp'
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
    `You are coaching ${you} (the human). Speak as “you”. Do not advise the opponent’s plans except to explain what you faced.`,
    'The move list and FENs below are ground truth for YOU only — do not invent what happened.',
    'CRITICAL — the player cannot replay move numbers yet. Do NOT cite move numbers, SAN, or UCI',
    '(no “7.Qe1”, no “1.b3”, no “Nxg6”). Talk in ideas a beginner can picture on the board:',
    'pieces, files, king safety, pawn weaknesses, development, checks, captures, hanging pieces.',
    'You may say “early on”, “in the opening”, “later”, “the finishing blow” — not ply indices.',
    'Write a post-game recap:',
    '1) One opening takeaway (development / center / king safety),',
    '2) 2–4 turning ideas from tagged mistakes/blunders, described as what went wrong and the safer idea,',
    '3) The main attacking or defensive theme if it showed up,',
    '4) One habit to practice next (e.g. checks, captures, king attacks).',
    '8–14 short sentences, plain English, no markdown headings or bullet lists.',
    'Reply with ONLY a single JSON object (no markdown fences): {"explanation":"..."}',
    '',
    `Outcome: ${you} ${body.outcome}.`,
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

function buildChatPrompt(body: CoachChatRequest, openingBrief?: string): string {
  const engineBlock =
    body.engineLines && body.engineLines.length > 0
      ? [
          '--- Top engine moves (for this position) ---',
          ...body.engineLines.map(
            (l, i) =>
              `${i + 1}. ${l.uci} (${l.from}→${l.to}) eval ${l.evalLabel}`,
          ),
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

  const review =
    body.reviewBrief?.trim()
      ? [
          '--- Game review context (post-game analysis) ---',
          body.reviewBrief.trim(),
          '',
        ].join('\n')
      : null

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
    review,
    conversation,
    '--- Current position (authoritative) ---',
    `FEN: ${body.fen}`,
    positionFacts(body.fen),
    body.bestMove
      ? `ENGINE BEST MOVE (selected/option 1 focus): ${body.bestMove}`
      : null,
    body.evalLabel ? `Engine eval: ${body.evalLabel}` : null,
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

type ChessComCallbackPayload = {
  game?: Record<string, unknown> & {
    pgnHeaders?: Record<string, string>
    endTime?: number
    end_time?: number
    white?: { username?: string }
    black?: { username?: string }
  }
  players?: {
    top?: { username?: string }
    bottom?: { username?: string }
  }
}

type ChessComArchiveGame = {
  url?: string
  pgn?: string
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'learn-chess-import/1.0',
    },
  })
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} for ${url}`)
  }
  return res.json()
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

async function latestChessComPgn(username: string): Promise<{ pgn: string }> {
  const user = username.trim().toLowerCase()
  if (!user || !/^[a-z0-9_-]{2,25}$/i.test(username.trim())) {
    throw new Error('Enter a chess.com username')
  }
  for (const { yyyy, mm } of recentChessComMonths(6)) {
    try {
      const archive = (await fetchJson(
        `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/${yyyy}/${mm}`,
      )) as { games?: Array<{ pgn?: string }> }
      const games = archive.games ?? []
      for (let i = games.length - 1; i >= 0; i--) {
        const pgn = games[i]?.pgn
        if (pgn?.trim()) return { pgn }
      }
    } catch {
      continue
    }
  }
  throw new Error('No recent chess.com games for that username')
}

function chessComMonthFromUnix(sec: number): { yyyy: string; mm: string } {
  const d = new Date(sec * 1000)
  return {
    yyyy: String(d.getUTCFullYear()),
    mm: String(d.getUTCMonth() + 1).padStart(2, '0'),
  }
}

async function importChessComPgn(urlOrId: string): Promise<{
  pgn: string
  white: string | null
  black: string | null
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

  const white =
    game.white?.username ??
    raw.players?.bottom?.username ??
    game.pgnHeaders?.White ??
    null
  const black =
    game.black?.username ??
    raw.players?.top?.username ??
    game.pgnHeaders?.Black ??
    null

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
    white: white?.trim() || null,
    black: black?.trim() || null,
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
            )
            sendJson(res, 200, defenses)
          } catch (err) {
            if (controller.signal.aborted) return
            const message =
              err instanceof Error ? err.message : 'opening defenses failed'
            const status = message.includes('LICHESS_API_TOKEN') ? 503 : 502
            sendJson(res, status, { error: message })
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
            )
            sendJson(res, 200, branch)
          } catch (err) {
            if (controller.signal.aborted) return
            const message =
              err instanceof Error ? err.message : 'opening branch failed'
            const status = message.includes('LICHESS_API_TOKEN') ? 503 : 502
            sendJson(res, status, { error: message })
          } finally {
            req.off('close', onClose)
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
            const { position } = await fetchExplorerWithToken(
              parsed.fen,
              parsed.ratings,
              controller.signal,
              parsed.options,
            )
            sendJson(res, 200, position)
          } catch (err) {
            if (controller.signal.aborted) return
            const message =
              err instanceof Error ? err.message : 'opening explorer failed'
            const status = message.includes('LICHESS_API_TOKEN') ? 503 : 502
            sendJson(res, status, { error: message })
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
            const body = JSON.parse(rawBody || '{}') as { url?: string }
            if (!body.url?.trim()) {
              sendJson(res, 400, { error: 'url required' })
              return
            }
            const result = await importChessComPgn(body.url)
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

          if (isReview) {
            const body = JSON.parse(raw) as ReviewRequest
            if (
              !body.gameId ||
              (body.playerColor !== 'white' && body.playerColor !== 'black') ||
              !['win', 'loss', 'draw'].includes(body.outcome) ||
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

            const stream = streamCoachAsk(
              buildReviewPrompt(body),
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
