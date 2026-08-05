import { spawn } from 'node:child_process'
import { Chess } from 'chess.js'
import type { Plugin } from 'vite'

export type ExplainRequest = {
  fen: string
  bestMove: string
  from: string
  to: string
  evalLabel: string
  line: string
  gameId: string
  /** Fullmove-ish hint so the coach can talk about game phase. */
  plyHint?: string
}

export type CoachChatRequest = {
  gameId: string
  fen: string
  question: string
  bestMove?: string
  evalLabel?: string
  tips?: { tip1: string; tip2: string; tip3: string }
}

/** Cheap Luna tier (fast) — override with CURSOR_EXPLAIN_MODEL. */
export const EXPLAIN_MODEL =
  process.env.CURSOR_EXPLAIN_MODEL ?? 'gpt-5.6-luna-low-fast'

/** Stable prefix — keep identical across asks for prompt-cache friendliness. */
const COACH_RULES = [
  'You are a friendly chess coach helping a beginner–club player.',
  'You are coaching ONE ongoing game. Earlier messages in this chat are prior tips for earlier positions—use that arc.',
  'Relate new advice to how the game has progressed when useful.',
  '',
  'CRITICAL — all three tips must align with the ENGINE BEST MOVE below.',
  'tip1, tip2, and tip3 are progressive reveals of THE SAME plan (the engine move)—not three different ideas.',
  'Do not hint at a different piece, plan, or move than the engine choice.',
  'UCI moves are long algebraic coordinates only: <from><to>[promotion] (examples: e2e4, e1g1 = castle, e7e8q = promote).',
  'UCI never names the piece; the mover is whatever occupies <from> in the FEN. Prefer the provided SAN in tip3.',
  'If earlier tips in this chat pointed elsewhere, course-correct toward this engine move.',
  '',
  'Reply with ONLY a single JSON object (no markdown fences, no other text) with exactly these keys:',
  '{"tip1":"...","tip2":"...","tip3":"..."}',
  '',
  'tip1: Soft nudge toward the theme of the engine move (why that idea matters now).',
  'Do NOT name a specific piece to move, and do NOT give a square or UCI/SAN move.',
  '1–2 short sentences.',
  '',
  'tip2: Narrow toward the engine move—you may name the piece type and/or board area involved.',
  'Still do NOT give the destination square or the full UCI/SAN move.',
  '1–2 short sentences.',
  '',
  'tip3: State the engine move exactly (prefer SAN plus from→to) and why it fits this game.',
  '2–3 short sentences. Plain English, no markdown headings or bullet lists.',
].join('\n')

/** Follow-up Q&A about tips / the recommended move (same Cursor chat session). */
const COACH_CHAT_RULES = [
  'You are a friendly chess coach helping a beginner–club player.',
  'You are coaching ONE ongoing game. Earlier messages may be tips for OLDER positions.',
  'CRITICAL: The CURRENT FEN and POSITION FACTS below are authoritative. Ignore piece placement from earlier turns if it conflicts.',
  'If POSITION FACTS say a castling side is legal or illegal, trust that—do not invent blockers.',
  'Answer the player’s follow-up question about those tips or this position.',
  'Stay aligned with the ENGINE BEST MOVE when discussing what to play—do not push a different move.',
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
      `Side to move: ${side}`,
      `Castling rights in FEN: ${rights}`,
      castlingLine,
    ].join('\n')
  } catch {
    return 'Position facts unavailable (invalid FEN).'
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

function buildPrompt(body: ExplainRequest): string {
  return [
    COACH_RULES,
    '',
    '--- Current position (same game as prior tips in this chat) ---',
    body.plyHint ? `Progress: ${body.plyHint}` : null,
    `FEN: ${body.fen}`,
    `ENGINE BEST MOVE (mandatory for tip3): ${body.bestMove}`,
    `From square: ${body.from}`,
    `To square: ${body.to}`,
    `Engine eval: ${body.evalLabel}`,
    `Principal variation: ${body.line}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function buildChatPrompt(body: CoachChatRequest): string {
  return [
    COACH_CHAT_RULES,
    '',
    '--- Current position (authoritative) ---',
    `FEN: ${body.fen}`,
    positionFacts(body.fen),
    body.bestMove ? `ENGINE BEST MOVE: ${body.bestMove}` : null,
    body.evalLabel ? `Engine eval: ${body.evalLabel}` : null,
    body.tips
      ? [
          '--- Tips already shown to the player (for this position) ---',
          `tip1: ${body.tips.tip1}`,
          `tip2: ${body.tips.tip2}`,
          `tip3: ${body.tips.tip3}`,
        ].join('\n')
      : null,
    '',
    `Player question: ${body.question.trim()}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function isGreetingNoise(text: string): boolean {
  const t = text.trim()
  return (
    /^hello boss man/i.test(t) ||
    /vamos a la playa/i.test(t) ||
    /let'?s get crackin/i.test(t)
  )
}

type StreamEvent = {
  type?: string
  subtype?: string
  timestamp_ms?: number
  message?: {
    content?: Array<{ type?: string; text?: string }>
  }
  result?: string
  is_error?: boolean
}

function createCursorChat(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('agent', ['create-chat'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => {
      out += d.toString()
    })
    child.stderr.on('data', (d) => {
      err += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const id = out.trim().split(/\s+/)[0]
      if (code === 0 && id && /^[0-9a-f-]{36}$/i.test(id)) {
        resolve(id)
        return
      }
      reject(new Error(err.trim() || `create-chat failed (${code})`))
    })
  })
}

/** Stream Cursor CLI ask-mode tokens via SSE, resuming the game chat. */
function streamCursorAsk(
  gameId: string,
  prompt: string,
  onDelta: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
): () => void {
  const args = [
    '-p',
    '-f',
    '--resume',
    gameId,
    '--mode',
    'ask',
    '--model',
    EXPLAIN_MODEL,
    '--output-format',
    'stream-json',
    '--stream-partial-output',
    prompt,
  ]

  const child = spawn('agent', args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let buffer = ''
  let assembled = ''
  let stderr = ''
  let settled = false

  const finishOk = () => {
    if (settled) return
    settled = true
    onDone(assembled.trim() || 'No explanation returned.')
  }

  const finishErr = (err: Error) => {
    if (settled) return
    settled = true
    onError(err)
  }

  child.stderr.on('data', (d) => {
    stderr += d.toString()
  })

  child.stdout.on('data', (d) => {
    buffer += d.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let event: StreamEvent
      try {
        event = JSON.parse(trimmed) as StreamEvent
      } catch {
        continue
      }

      if (event.type === 'assistant' && event.message?.content) {
        if (typeof event.timestamp_ms !== 'number') continue
        for (const block of event.message.content) {
          if (block.type !== 'text' || !block.text) continue
          if (isGreetingNoise(block.text)) continue
          assembled += block.text
          onDelta(block.text)
        }
      }

      if (event.type === 'result') {
        if (event.is_error) {
          finishErr(new Error(event.result || 'Cursor agent failed'))
          return
        }
        if (!assembled.trim() && event.result) {
          assembled = event.result
          onDelta(event.result)
        }
        finishOk()
      }
    }
  })

  child.on('error', (err) => finishErr(err))
  child.on('close', (code) => {
    if (settled) return
    if (code !== 0) {
      finishErr(
        new Error(stderr.trim() || `Cursor agent exited with code ${code}`),
      )
      return
    }
    finishOk()
  })

  return () => {
    settled = true
    child.kill('SIGTERM')
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

/** Vite middleware: coach explain + gameId minting. */
export function explainApiPlugin(): Plugin {
  return {
    name: 'chess-coach-explain-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''

        if (url === '/api/game-id' && req.method === 'POST') {
          try {
            const gameId = await createCursorChat()
            sendJson(res, 200, { gameId })
          } catch (err) {
            sendJson(res, 500, {
              error: err instanceof Error ? err.message : 'create-chat failed',
            })
          }
          return
        }

        const isExplain = url.startsWith('/api/explain')
        const isCoachChat = url.startsWith('/api/coach-chat')
        if (!isExplain && !isCoachChat) return next()

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

            cancel = streamCursorAsk(
              body.gameId,
              buildChatPrompt(body),
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

            req.on('close', () => cancel?.())
            return
          }

          const body = JSON.parse(raw) as ExplainRequest
          if (!body.fen || !body.bestMove || !body.gameId) {
            sendJson(res, 400, {
              error: 'fen, bestMove, and gameId required',
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

          cancel = streamCursorAsk(
            body.gameId,
            buildPrompt(body),
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

          req.on('close', () => cancel?.())
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
      })
    },
  }
}
