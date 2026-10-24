import {
  lichessExplorerQuery,
  parseExplorerPosition,
  type ExplorerMonth,
  type ExplorerPosition,
  type ExplorerSpeed,
  type RatingBandId,
} from '../src/lib/lichessExplorer.js'

/**
 * Vercel and the local site call the home gateway. The gateway process
 * must leave EXPLORER_ORIGIN unset so it reads the month files itself.
 */
export function explorerOrigin(): string | null {
  const raw = process.env.EXPLORER_ORIGIN?.trim()
  if (!raw) return null
  const url = new URL(raw)
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return url.origin
  throw new Error('EXPLORER_ORIGIN must be https, or http on this computer')
}

async function gatewayFetch(pathAndQuery: string): Promise<unknown> {
  const origin = explorerOrigin()
  const secret = process.env.EXPLORER_GATEWAY_SECRET?.trim()
  if (!origin || !secret) {
    throw new Error('The opening explorer gateway is not configured.')
  }
  let res: Response
  try {
    res = await fetch(`${origin}${pathAndQuery}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error('The opening explorer took too long.')
    }
    throw new Error('The opening explorer on the home machine is offline.')
  }
  let payload: unknown = null
  try {
    payload = await res.json()
  } catch {
    payload = null
  }
  if (!res.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : 'The opening explorer on the home machine is offline.'
    throw new Error(message)
  }
  return payload
}

export async function fetchRemoteMonths(): Promise<string[]> {
  const payload = await gatewayFetch('/api/explorer-months')
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { months?: unknown }).months)) {
    throw new Error('The opening explorer returned an unexpected response.')
  }
  return (payload as { months: unknown[] }).months.filter(
    (month): month is string => typeof month === 'string',
  )
}

export async function fetchRemotePosition(input: {
  fen: string
  ratings: readonly RatingBandId[]
  play: string
  speeds: readonly ExplorerSpeed[]
  months: readonly ExplorerMonth[]
}): Promise<ExplorerPosition> {
  const query = lichessExplorerQuery(input.fen, input.ratings, {
    play: input.play || undefined,
    speeds: input.speeds,
    months: input.months,
  })
  return parseExplorerPosition(await gatewayFetch(`/api/opening-explorer?${query}`))
}
