import { spawn } from 'node:child_process'
import type { Plugin } from 'vite'

export type ExplainRequest = {
  fen: string
  bestMove: string
  from: string
  to: string
  evalLabel: string
  line: string
}

/** Cheap Luna tier (fast) — override with CURSOR_EXPLAIN_MODEL. */
export const EXPLAIN_MODEL =
  process.env.CURSOR_EXPLAIN_MODEL ?? 'gpt-5.6-luna-low-fast'

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
    'You are a friendly chess coach. Reply with ONLY a short explanation (2–4 sentences).',
    'No greeting, no preamble, no markdown headings, no bullet lists.',
    'Explain why the recommended move is good in plain English for a beginner–club player.',
    '',
    `FEN: ${body.fen}`,
    `Recommended move (UCI): ${body.bestMove} (${body.from} → ${body.to})`,
    `Engine eval: ${body.evalLabel}`,
    `Principal variation: ${body.line}`,
  ].join('\n')
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

/** Stream Cursor CLI ask-mode tokens via SSE. */
function streamCursorExplain(
  body: ExplainRequest,
  onDelta: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
): () => void {
  const prompt = buildPrompt(body)
  const args = [
    '-p',
    '-f',
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
        // Partial deltas include timestamp_ms; final full copy does not.
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
      finishErr(new Error(stderr.trim() || `Cursor agent exited with code ${code}`))
      return
    }
    finishOk()
  })

  return () => {
    settled = true
    child.kill('SIGTERM')
  }
}

/** Vite middleware: POST /api/explain → streamed Luna coach text (SSE). */
export function explainApiPlugin(): Plugin {
  return {
    name: 'chess-coach-explain-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/explain')) return next()
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
          const body = JSON.parse(raw) as ExplainRequest
          if (!body.fen || !body.bestMove) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'fen and bestMove required' }))
            return
          }

          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            'X-Explain-Model': EXPLAIN_MODEL,
          })

          const send = (payload: unknown) => {
            res.write(`data: ${JSON.stringify(payload)}\n\n`)
          }

          send({ type: 'model', model: EXPLAIN_MODEL })

          cancel = streamCursorExplain(
            body,
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
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                error: err instanceof Error ? err.message : 'Explain failed',
              }),
            )
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
