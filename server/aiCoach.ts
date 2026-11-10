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

/**
 * Some providers stream their thinking as ordinary text. These openers are
 * the model talking to itself, not an answer, so they never reach the player.
 */
const DELIBERATION_START =
  /^(we need|we must|we should|let'?s|let us|need (to )?check|need check|actually\b|wait\b|hmm\b|okay,? so\b|i need|i should|reconstruct|check\b|so the answer|first,? (we|i)\b)/i

/** Self-talk that can appear mid-sentence, not just at the start. */
const DELIBERATION_ANYWHERE =
  /\b(actually|need check|let'?s reconstruct|let us reconstruct|reconstruct exact|wait,? (no|the)|hmm)\b/i

function isDeliberation(sentence: string): boolean {
  const text = sentence.trim()
  if (!text) return true
  return DELIBERATION_START.test(text) || DELIBERATION_ANYWHERE.test(text)
}

/**
 * Emit whole sentences, dropping self-talk that leaks before the real answer.
 * Buffering one sentence keeps a leaked "Actually…" from flashing on screen.
 * JSON replies (the explain card) pass through untouched — filtering would
 * corrupt the object the client parses.
 */
export function createAnswerFilter(onDelta: (text: string) => void) {
  let buffer = ''
  let answer = ''
  let mode: 'unknown' | 'json' | 'text' = 'unknown'

  const emit = (sentence: string) => {
    const text = sentence.trim()
    if (!text) return
    // Self-talk can appear anywhere ("Actually f4 is not controlled… Need
    // check."), so drop those sentences wherever they land.
    if (isDeliberation(text)) return
    answer += sentence
    onDelta(sentence)
  }

  const drain = (final: boolean) => {
    for (;;) {
      // A JSON reply must never be split on the periods inside its string.
      if (buffer.trimStart().startsWith('{')) {
        mode = 'json'
        answer += buffer
        onDelta(buffer)
        buffer = ''
        return
      }
      const match = /[.!?](?=\s|$)/.exec(buffer)
      if (!match) break
      const end = match.index + 1
      const sentence = buffer.slice(0, end)
      buffer = buffer.slice(end).replace(/^\s+/, '')
      emit(sentence)
    }
    if (final && buffer.trim()) {
      emit(buffer)
      buffer = ''
    }
  }

  return {
    push(text: string) {
      if (mode === 'unknown') {
        const head = (buffer + text).trimStart()
        if (!head) {
          buffer += text
          return
        }
        mode = head.startsWith('{') ? 'json' : 'text'
        if (mode === 'json') {
          // Flush anything buffered before the object so the JSON stays whole.
          const chunk = buffer + text
          buffer = ''
          answer += chunk
          onDelta(chunk)
          return
        }
      }
      if (mode === 'json') {
        answer += text
        onDelta(text)
        return
      }
      buffer += text
      drain(false)
    },
    end(): string {
      if (mode === 'json') return answer.trim()
      drain(true)
      return answer.trim()
    },
  }
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

  const filter = createAnswerFilter(onDelta)
  for await (const part of result.stream) {
    if (part.type === 'error') throw part.error
    // Reasoning parts are the model's private scratchpad — never forward them.
    if (part.type !== 'text-delta') continue
    const text = deltaText(part)
    if (!text) continue
    filter.push(text)
  }
  let assembled = filter.end()
  if (!assembled) {
    const full = (await result.text).trim()
    if (full) {
      const fallback = createAnswerFilter(onDelta)
      fallback.push(full)
      assembled = fallback.end()
    }
  }
  return assembled
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
