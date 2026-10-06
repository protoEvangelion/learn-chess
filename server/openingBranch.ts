import { getTurso } from './turso.js'
import { fetchExplorerWithToken } from './lichessExplorerProxy.js'
import {
  branchKeyFrom,
  directChildren,
  loadOpeningBook,
  movesAfter,
} from './openingBook.js'
import type {
  BranchMover,
  ExplorerOpening,
  OpeningBranch,
  OpeningBranchLine,
  RatingBandId,
} from '../src/lib/lichessExplorer.js'
import { EXPLORER_MOVE_CAP } from '../src/lib/lichessExplorer.js'

const CACHE_VERSION = 'v1'

let schemaReady: Promise<void> | null = null
const memory = new Map<string, OpeningBranch>()
let upstreamChain: Promise<unknown> = Promise.resolve()

function cacheKey(fen: string, ratings: readonly RatingBandId[], play: string) {
  return `${CACHE_VERSION}|${ratings.join(',')}|${play}|${fen}`
}

function sameLine(a: string, b: string) {
  return a === b || a.endsWith(`: ${b}`) || b.endsWith(`: ${a}`)
}

function alreadyListed(lines: OpeningBranchLine[], name: string) {
  return lines.some((line) => sameLine(line.name, name))
}

function sideToMove(fen: string): BranchMover {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

function lastMover(fen: string, play: string): BranchMover {
  const plies = play.split(',').filter(Boolean).length
  const start = sideToMove(fen)
  if (plies <= 0) return start
  const whitePlayedLast = start === 'white' ? plies % 2 === 1 : plies % 2 === 0
  return whitePlayedLast ? 'white' : 'black'
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getTurso()
      .execute(`
        CREATE TABLE IF NOT EXISTS explorer_branches (
          cache_key TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)
      .then(() => undefined)
      .catch((err) => {
        schemaReady = null
        throw err
      })
  }
  await schemaReady
}

async function readStored(key: string): Promise<OpeningBranch | null> {
  const hit = memory.get(key)
  if (hit) return hit
  try {
    await ensureSchema()
    const result = await getTurso().execute({
      sql: 'SELECT payload FROM explorer_branches WHERE cache_key = ?',
      args: [key],
    })
    const row = result.rows[0]
    if (!row) return null
    const payload = JSON.parse(String(row.payload)) as OpeningBranch
    if (!payload || !Array.isArray(payload.lines)) return null
    memory.set(key, payload)
    return payload
  } catch {
    return null
  }
}

async function writeStored(key: string, payload: OpeningBranch) {
  memory.set(key, payload)
  try {
    await ensureSchema()
    await getTurso().execute({
      sql: `
        INSERT INTO explorer_branches (cache_key, payload, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(cache_key) DO UPDATE SET
          payload = excluded.payload,
          updated_at = datetime('now')
      `,
      args: [key, JSON.stringify(payload)],
    })
  } catch {
    // The response is still usable for this request.
  }
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = upstreamChain.then(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120))
    return fn()
  })
  upstreamChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function fetchPosition(
  fen: string,
  ratings: readonly RatingBandId[],
  play: string,
  signal: AbortSignal,
) {
  const attempt = () =>
    fetchExplorerWithToken(fen, ratings, signal, {
      play,
      moves: EXPLORER_MOVE_CAP,
    })
  try {
    return await enqueue(attempt)
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (!message.includes('429')) throw err
    await new Promise((resolve) => setTimeout(resolve, 2000))
    return enqueue(attempt)
  }
}

function lineFromMove(
  move: {
    opening: ExplorerOpening | null
    white: number
    draws: number
    black: number
    averageRating: number
  },
  mover: BranchMover,
): OpeningBranchLine | null {
  if (!move.opening) return null
  return {
    name: move.opening.name,
    eco: move.opening.eco,
    white: move.white,
    draws: move.draws,
    black: move.black,
    averageRating: move.averageRating,
    mover,
  }
}

/**
 * Named lines at `play` from `fen`. Every explorer reply is kept, then any
 * opening-tree child that is still missing is requested on its own branch
 * and stored.
 */
export async function loadOpeningBranch(
  fen: string,
  ratings: readonly RatingBandId[],
  play: string,
  signal?: AbortSignal,
): Promise<OpeningBranch> {
  const ac = new AbortController()
  const onAbort = () => ac.abort()
  if (signal) {
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  const key = cacheKey(fen, ratings, play)
  try {
    const stored = await readStored(key)
    if (stored) return stored

    const { position } = await fetchPosition(fen, ratings, play, ac.signal)
    const parentName = position.opening?.name ?? ''
    const replySide = lastMover(fen, play) === 'white' ? 'black' : 'white'
    const lines: OpeningBranchLine[] = []
    for (const move of position.moves) {
      const line = lineFromMove(move, replySide)
      if (!line) continue
      if (parentName && line.name === parentName) continue
      if (alreadyListed(lines, line.name)) continue
      lines.push(line)
    }

    let complete = true
    let opening = position.opening
    try {
      const book = await loadOpeningBook()
      const branchKey = branchKeyFrom(fen, play)
      const exact = book.lines.find((line) => line.keys[line.keys.length - 1] === branchKey)
      const resolvedParent = exact?.name || parentName
      if (!opening && exact) opening = { eco: exact.eco, name: exact.name }
      const missing = directChildren(book, resolvedParent).filter(
        (child) => !alreadyListed(lines, child.name),
      )
      for (const child of missing) {
        if (ac.signal.aborted) {
          complete = false
          break
        }
        const rest = movesAfter(child, branchKey)
        if (!rest || rest.length === 0) continue
        const fullPlay = `${play},${rest.join(',')}`
        const mover = lastMover(fen, fullPlay)
        try {
          const { position: reached } = await fetchPosition(
            fen,
            ratings,
            fullPlay,
            ac.signal,
          )
          const name = reached.opening?.name || child.name
          if (alreadyListed(lines, name) || alreadyListed(lines, child.name)) continue
          lines.push({
            name: child.name,
            eco: reached.opening?.eco || child.eco,
            white: reached.white,
            draws: reached.draws,
            black: reached.black,
            averageRating: 0,
            mover,
          })
        } catch (err) {
          if (ac.signal.aborted) throw err
          complete = false
          lines.push({
            name: child.name,
            eco: child.eco,
            white: 0,
            draws: 0,
            black: 0,
            averageRating: 0,
            mover,
          })
        }
      }
    } catch (err) {
      if (ac.signal.aborted) throw err
      complete = false
    }

    const payload: OpeningBranch = { opening, lines }
    if (complete && !ac.signal.aborted) await writeStored(key, payload)
    return payload
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
