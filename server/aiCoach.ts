import { generateText, streamText } from 'ai'

/** Cheap, fast model for Stockfish-grounded coaching. */
export const EXPLAIN_MODEL =
  process.env.AI_COACH_MODEL ?? 'deepseek/deepseek-v4.1-flash'

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
      })

      let assembled = ''
      for await (const text of result.textStream) {
        assembled += text
        onDelta(text)
      }
      onDone(assembled.trim() || 'No explanation returned.')
    } catch (error) {
      if (controller.signal.aborted) return
      onError(error instanceof Error ? error : new Error(String(error)))
    }
  })()

  return {
    cancel: () => controller.abort(),
    done,
  }
}

/** One-shot generation for Turso-cached opening briefings. */
export async function askCoachOnce(prompt: string): Promise<string> {
  const { text } = await generateText({
    model: EXPLAIN_MODEL,
    prompt,
    maxOutputTokens: 1_200,
    timeout: 55_000,
  })
  return text
}
