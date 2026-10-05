import { streamText } from 'ai'

/** Cheap, fast model for Stockfish-grounded coaching. */
export const EXPLAIN_MODEL =
  process.env.AI_COACH_MODEL ?? 'deepseek/deepseek-v4.1-flash'

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

export function streamCoachAsk(
  prompt: string,
  onDelta: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
): { cancel: () => void; done: Promise<void> } {
  const controller = new AbortController()

  const done = (async () => {
    try {
      const result = streamText({
        model: EXPLAIN_MODEL,
        prompt,
        abortSignal: controller.signal,
        maxOutputTokens: 1_200,
        timeout: 55_000,
        // V4 Flash reasons by default and can end with no answer text.
        reasoning: 'none',
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
      if (!assembled.trim()) {
        const reasoned = (await result.reasoningText)?.trim() ?? ''
        if (reasoned.includes('"explanation"') || reasoned.length > 40) {
          assembled = reasoned
          onDelta(reasoned)
        }
      }
      if (!assembled.trim()) throw new Error('AI Gateway returned no text')
      onDone(assembled.trim())
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
