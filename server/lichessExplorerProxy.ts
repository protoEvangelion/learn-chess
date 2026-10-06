import {
  isRatingBandId,
  lichessExplorerUrl,
  parseExplorerPosition,
  type ExplorerPosition,
  type RatingBandId,
} from '../src/lib/lichessExplorer.js'

const USER_AGENT = 'learn-chess (https://learn-chess-fawn.vercel.app)'

export function readExplorerQuery(
  rawUrl: string | undefined,
): { fen: string; rating: RatingBandId } | { error: string } {
  const query = new URL(rawUrl ?? '', 'http://localhost').searchParams
  const fen = query.get('fen')?.trim() ?? ''
  const rating = query.get('ratings')?.trim() ?? ''
  if (!fen || fen.length > 200) return { error: 'fen is required' }
  if (!isRatingBandId(rating)) return { error: 'ratings must be one band' }
  return { fen, rating }
}

/**
 * Server-side explorer call. Anonymous requests get nginx 401; the token
 * stays on the server.
 */
export async function fetchExplorerWithToken(
  fen: string,
  rating: RatingBandId,
  signal?: AbortSignal,
): Promise<{ position: ExplorerPosition; upstream: string }> {
  const token = (
    process.env.LICHESS_API_TOKEN || process.env.LICHESS_TOKEN
  )?.trim()
  if (!token) {
    throw new Error(
      'Set LICHESS_API_TOKEN (or LICHESS_TOKEN) on the server to a Lichess personal API token from https://lichess.org/account/oauth/token. Anonymous explorer requests are rejected.',
    )
  }
  const upstream = lichessExplorerUrl(fen, rating)
  let res: Response
  try {
    res = await fetch(upstream, {
      signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
      },
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error("Couldn't reach the Lichess explorer.")
  }
  if (res.status === 401) {
    throw new Error(
      'Lichess rejected LICHESS_API_TOKEN. Create a personal token at https://lichess.org/account/oauth/token and set that env var on the server.',
    )
  }
  if (!res.ok) {
    throw new Error(`Lichess explorer returned ${res.status}.`)
  }
  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    throw new Error('Lichess explorer returned an unreadable response.')
  }
  return { position: parseExplorerPosition(payload), upstream }
}
