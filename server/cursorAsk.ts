import { spawn } from 'node:child_process'

/** Cheap Luna tier (fast) — override with CURSOR_EXPLAIN_MODEL. */
export const EXPLAIN_MODEL =
  process.env.CURSOR_EXPLAIN_MODEL ?? 'gpt-5.6-luna-low-fast'

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

export function createCursorChat(): Promise<string> {
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

/** Stream Cursor CLI ask-mode tokens, resuming the given chat. */
export function streamCursorAsk(
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

/** One-shot ask in a fresh chat (for cached briefing generation). */
export async function askCursorOnce(prompt: string): Promise<string> {
  const chatId = await createCursorChat()
  return new Promise((resolve, reject) => {
    streamCursorAsk(
      chatId,
      prompt,
      () => {},
      (full) => resolve(full),
      reject,
    )
  })
}
