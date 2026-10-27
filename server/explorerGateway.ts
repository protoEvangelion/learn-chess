import { timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { listExplorerMonths, queryExplorerPosition } from './explorerStats.js'
import { readExplorerQuery } from './lichessExplorerProxy.js'

/**
 * The only network door to the month files.
 * It listens on this computer, requires a shared secret, and answers two reads.
 */

delete process.env.EXPLORER_ORIGIN
delete process.env.EDGE_CONFIG

const PORT = 3921
const HOST = '127.0.0.1'
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 60
const hits: number[] = []

function loadSecret(): string {
  const fromEnv = process.env.EXPLORER_GATEWAY_SECRET?.trim()
  if (fromEnv) return fromEnv
  const file = path.join(os.homedir(), '.config', 'learn-chess', 'explorer.env')
  const text = readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('EXPLORER_GATEWAY_SECRET=')) continue
    return trimmed.slice('EXPLORER_GATEWAY_SECRET='.length).trim()
  }
  throw new Error('EXPLORER_GATEWAY_SECRET is missing')
}

const secret = loadSecret()

function authorized(header: string | undefined): boolean {
  const match = header?.match(/^Bearer\s+(\S+)\s*$/)
  if (!match) return false
  const got = Buffer.from(match[1])
  const expected = Buffer.from(secret)
  if (got.length !== expected.length) return false
  return timingSafeEqual(got, expected)
}

function allow(): boolean {
  const now = Date.now()
  while (hits.length > 0 && now - hits[0] >= WINDOW_MS) hits.shift()
  if (hits.length >= MAX_PER_WINDOW) return false
  hits.push(now)
  return true
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function failureStatus(message: string): number {
  if (message.includes('busy')) return 503
  if (message.includes('too long')) return 504
  return 500
}

const server = http.createServer((req, res) => {
  const method = req.method ?? 'GET'
  if (method !== 'GET') {
    send(res, 405, { error: 'Method not allowed' })
    return
  }
  if (!authorized(req.headers.authorization)) {
    send(res, 401, { error: 'unauthorized' })
    return
  }
  if (!allow()) {
    send(res, 429, { error: 'The opening explorer is busy.' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/api/explorer-months') {
    listExplorerMonths()
      .then((months) => send(res, 200, { months }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'explorer months failed'
        send(res, failureStatus(message), { error: message })
      })
    return
  }
  if (url.pathname === '/api/opening-explorer') {
    const parsed = readExplorerQuery(req.url)
    if ('error' in parsed) {
      send(res, 400, { error: parsed.error })
      return
    }
    queryExplorerPosition(
      parsed.fen,
      parsed.ratings,
      parsed.options.play ?? '',
      parsed.speeds,
      parsed.months,
    )
      .then((position) => send(res, 200, position))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'opening explorer failed'
        send(res, failureStatus(message), { error: message })
      })
    return
  }
  send(res, 404, { error: 'Not found' })
})

server.maxRequestsPerSocket = 20
server.requestTimeout = 25_000
server.headersTimeout = 5_000
server.listen(PORT, HOST, () => {
  process.stdout.write(`explorer gateway listening on http://${HOST}:${PORT}\n`)
})
