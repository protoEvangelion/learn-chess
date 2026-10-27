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
 * must leave EXPLORER_ORIGIN and EDGE_CONFIG unset so it reads the month files itself.
 * The live site reads the current tunnel address from EDGE_CONFIG so a reboot
 * can publish a new address without another deploy.
 */
const ORIGIN_CACHE_MS = 15_000
let cachedOrigin: { value: string; at: number } | null = null

export function explorerUsesRemote(): boolean {
  return Boolean(process.env.EDGE_CONFIG?.trim() || process.env.EXPLORER_ORIGIN?.trim())
}

function acceptOrigin(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    const tunnel = url.protocol === 'https:' && url.hostname.endsWith('.trycloudflare.com')
    if (tunnel || (url.protocol === 'http:' && local)) return url.origin
  } catch {
    return null
  }
  return null
}

async function readEdgeOrigin(): Promise<string | null> {
  const edge = process.env.EDGE_CONFIG?.trim()
  if (!edge) return null
  if (cachedOrigin && Date.now() - cachedOrigin.at < ORIGIN_CACHE_MS) return cachedOrigin.value
  let connection: URL
  try {
    connection = new URL(edge)
  } catch {
    return cachedOrigin?.value ?? null
  }
  const item = new URL(connection.href)
  item.pathname = `${connection.pathname.replace(/\/$/, '')}/item/origin`
  try {
    const res = await fetch(item, { cache: 'no-store', signal: AbortSignal.timeout(3_000) })
    if (!res.ok) return cachedOrigin?.value ?? null
    const value = await res.json()
    const origin = typeof value === 'string' ? acceptOrigin(value) : null
    if (!origin) return cachedOrigin?.value ?? null
    cachedOrigin = { value: origin, at: Date.now() }
    return origin
  } catch {
    return cachedOrigin?.value ?? null
  }
}

async function resolveOrigin(): Promise<string | null> {
  const edged = await readEdgeOrigin()
  if (edged) return edged
  const raw = process.env.EXPLORER_ORIGIN?.trim()
  return raw ? acceptOrigin(raw) : null
}

async function gatewayFetch(pathAndQuery: string): Promise<unknown> {
  const origin = await resolveOrigin()
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
