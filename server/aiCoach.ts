import { streamText } from 'ai'

/** Cheap, fast model for Stockfish-grounded coaching. */
export const EXPLAIN_MODEL =
  process.env.AI_COACH_MODEL ?? 'deepseek/deepseek-v4.1-flash'

/**
 * DeepSeek V4.1 Flash effort, via the AI SDK (AI Gateway).
 * Catalog effort for this model: none | low | high | max.
 * `low` is that provider's low setting. It still asks for a normal text answer.
 * Do not set this back to `none` — that turns thinking off.
 */
export const COACH_REASONING = 'low' as const

function deltaText(part: { text?: unknown; delta?: unknown }): string {
  if (typeof part.text === 'string') return part.text
  if (typeof part.delta === 'string') return part.delta
  return ''
}

function stripAnsi(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) === 27) {
      const end = value.indexOf('m', i)
      i = end === -1 ? i : end
      continue
    }
    out += value[i]
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** DeepSeek V4 thinks by default and can finish with reasoning and no answer. */
function coachError(error: unknown): Error {
  const raw = error instanceof Error ? error : new Error(String(error))
  const plain = stripAnsi(raw.message)
  if (
    raw.name === 'GatewayAuthenticationError' ||
    raw.name === 'GatewayError' ||
    /AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN|Unauthenticated/i.test(plain)
  ) {
    return new Error(
      'AI Gateway is not authenticated. Locally, set AI_GATEWAY_API_KEY (Vercel project → AI Gateway → API keys). On Vercel, enable AI Gateway so the deployment uses VERCEL_OIDC_TOKEN.',
    )
  }
  return new Error(plain || 'Coach request failed')
}

/**
 * One model call at low thinking. Returns the answer text only.
 * Reasoning tokens are not shown to the player.
 */
async function readCoachAnswer(
  prompt: string,
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<string> {
  const result = streamText({
    model: EXPLAIN_MODEL,
    prompt,
    abortSignal: signal,
    maxOutputTokens: 1_200,
    timeout: 55_000,
    reasoning: COACH_REASONING,
  })

  let assembled = ''
  for await (const part of result.stream) {
    if (part.type === 'error') throw part.error
    if (part.type !== 'text-delta') continue
    const text = deltaText(part)
    if (!text) continue
    assembled += text
    onDelta(text)
  }
  if (!assembled.trim()) {
    const full = (await result.text).trim()
    if (full) {
      assembled = full
      onDelta(full)
    }
  }
  return assembled.trim()
}

export function streamCoachAsk(
  prompt: string,
  onDelta: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
): { cancel: () => void; done: Promise<void> } {
  const controller = new AbortController()

  const done = (async () => {
    try {
      let text = await readCoachAnswer(prompt, controller.signal, onDelta)
      // Low thinking can still come back as reasoning with an empty answer.
      // One more try, still at low — never drop back to reasoning: 'none'.
      if (!text && !controller.signal.aborted) {
        text = await readCoachAnswer(
          `${prompt}\n\nThe last reply had no answer text. Reply again with the answer in the normal message.`,
          controller.signal,
          onDelta,
        )
      }
      if (!text) throw new Error('AI Gateway returned no text')
      onDone(text)
    } catch (error) {
      if (controller.signal.aborted) return
      onError(coachError(error))
    }
  })()

  return {
    cancel: () => controller.abort(),
    done,
  }
}
