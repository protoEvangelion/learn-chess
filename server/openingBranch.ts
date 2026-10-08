import { Chess } from 'chess.js'
import { getTurso } from './turso.js'
import { queryExplorerPosition } from './explorerStats.js'
import {
  branchKeyFrom,
  directChildren,
  lineReachedByPlay,
  loadOpeningBook,
  movesAfter,
  openingReachedByPlay,
} from './openingBook.js'
import type {
  BlackDefense,
  BlackDefenseList,
  BranchMover,
  ExplorerOpening,
  OpeningBranch,
  OpeningBranchLine,
  RatingBandId,
} from '../src/lib/lichessExplorer.js'
import { isOpeningVariation } from '../src/lib/lichessExplorer.js'

const CACHE_VERSION = 'v3'
const START_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
/** Serve a stored row only while it is under 7 days old. */
export const EXPLORE_CACHE_MS = 7 * 24 * 60 * 60 * 1000

type Timed<T> = { payload: T; updatedAtMs: number }

let schemaReady: Promise<void> | null = null
let nowFn = () => Date.now()
const memory = new Map<string, Timed<OpeningBranch>>()
const defenseMemory = new Map<string, Timed<BlackDefenseList>>()

function cacheKey(fen: string, ratings: readonly RatingBandId[], play: string) {
  return `${CACHE_VERSION}|${ratings.join(',')}|${play}|${fen}`
}

function defenseCacheKey(ratings: readonly RatingBandId[]) {
  return `${CACHE_VERSION}|defenses|${ratings.join(',')}`
}

function cacheNow() {
  return nowFn()
}

/** Test hook. Pass null to use the real clock. */
export function setExploreCacheNow(fn: (() => number) | null) {
  nowFn = fn ?? (() => Date.now())
}

export function updatedAtMs(updatedAt: unknown): number | null {
  if (typeof updatedAt === 'number' && Number.isFinite(updatedAt)) return updatedAt
  if (typeof updatedAt !== 'string') return null
  const text = updatedAt.trim()
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/** True when `updatedAt` is strictly under 7 days before `now`. */
export function exploreUpdatedAtFresh(updatedAt: unknown, now = cacheNow()): boolean {
  const ms = updatedAtMs(updatedAt)
  if (ms === null) return false
  return now - ms < EXPLORE_CACHE_MS
}

function takeFresh<T>(map: Map<string, Timed<T>>, key: string, now: number): T | null {
  const hit = map.get(key)
  if (!hit) return null
  if (!exploreUpdatedAtFresh(hit.updatedAtMs, now)) {
    map.delete(key)
    return null
  }
  return hit.payload
}

function remember<T>(map: Map<string, Timed<T>>, key: string, payload: T, updatedAtMs: number) {
  map.set(key, { payload, updatedAtMs })
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

export async function readCachedOpeningBranch(key: string): Promise<OpeningBranch | null> {
  return readStored(key)
}

async function readStored(key: string): Promise<OpeningBranch | null> {
  const now = cacheNow()
  const cached = takeFresh(memory, key, now)
  if (cached) return cached
  try {
    await ensureSchema()
    const result = await getTurso().execute({
      sql: 'SELECT payload, updated_at FROM explorer_branches WHERE cache_key = ?',
      args: [key],
    })
    const row = result.rows[0]
    if (!row) return null
    if (!exploreUpdatedAtFresh(row.updated_at, now)) return null
    const payload = JSON.parse(String(row.payload)) as OpeningBranch
    if (!payload || !Array.isArray(payload.lines)) return null
    const stamped = updatedAtMs(row.updated_at)
    if (stamped === null) return null
    remember(memory, key, payload, stamped)
    return payload
  } catch {
    return null
  }
}

async function writeStored(key: string, payload: OpeningBranch) {
  const stamped = cacheNow()
  remember(memory, key, payload, stamped)
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

/** Delete rows older than 7 days. Fresher rows, including other rating bands, stay. */
export async function purgeExpiredExplorerBranches(): Promise<number> {
  await ensureSchema()
  const now = cacheNow()
  for (const [key, entry] of memory) {
    if (!exploreUpdatedAtFresh(entry.updatedAtMs, now)) memory.delete(key)
  }
  for (const [key, entry] of defenseMemory) {
    if (!exploreUpdatedAtFresh(entry.updatedAtMs, now)) defenseMemory.delete(key)
  }
  const result = await getTurso().execute(
    `DELETE FROM explorer_branches WHERE updated_at < datetime('now', '-7 days')`,
  )
  return Number(result.rowsAffected ?? 0)
}

async function fetchPosition(
  fen: string,
  ratings: readonly RatingBandId[],
  play: string,
  signal: AbortSignal,
) {
  if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
  const position = await queryExplorerPosition(fen, ratings, play)
  if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
  return { position }
}

function lineFromMove(
  move: {
    opening: ExplorerOpening | null
    san: string
    uci: string
    white: number
    draws: number
    black: number
    averageRating: number
  },
  mover: BranchMover,
  play: string,
): OpeningBranchLine | null {
  if (!move.opening || !move.uci) return null
  const reached = play ? `${play},${move.uci}` : move.uci
  return {
    name: move.opening.name,
    eco: move.opening.eco,
    san: move.san,
    play: reached,
    white: move.white,
    draws: move.draws,
    black: move.black,
    averageRating: move.averageRating,
    mover,
  }
}

function sanAfter(fen: string, play: string, uci: string): string {
  try {
    const chess = new Chess(fen)
    for (const step of play.split(',').filter(Boolean)) {
      const played = chess.move({
        from: step.slice(0, 2),
        to: step.slice(2, 4),
        promotion: step[4] || undefined,
      })
      if (!played) return ''
    }
    const next = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || undefined,
    })
    return next?.san ?? ''
  } catch {
    return ''
  }
}

async function attachMissingSans(
  fen: string,
  play: string,
  lines: OpeningBranchLine[],
): Promise<OpeningBranchLine[]> {
  if (lines.every((line) => line.san && line.play)) return lines
  try {
    const book = await loadOpeningBook()
    const branchKey = branchKeyFrom(fen, play)
    return lines.map((line) => {
      if (line.san && line.play) return line
      const child = book.lines.find((entry) => entry.name === line.name)
      const rest = child ? movesAfter(child, branchKey) : null
      const san = rest?.[0] ? sanAfter(fen, play, rest[0]) : ''
      const reached =
        line.play || !rest || rest.length === 0
          ? line.play
          : `${play},${rest.join(',')}`
      if (!san && !reached) return line
      return { ...line, san: line.san || san, play: reached || line.play }
    })
  } catch {
    return lines
  }
}

function defenseGames(row: { white: number; draws: number; black: number }) {
  return row.white + row.draws + row.black
}

function isDefenseList(value: unknown): value is BlackDefenseList {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Array.isArray((value as BlackDefenseList).defenses),
  )
}

async function readDefense(key: string): Promise<BlackDefenseList | null> {
  const now = cacheNow()
  const cached = takeFresh(defenseMemory, key, now)
  if (cached) return cached
  try {
    await ensureSchema()
    const result = await getTurso().execute({
      sql: 'SELECT payload, updated_at FROM explorer_branches WHERE cache_key = ?',
      args: [key],
    })
    const row = result.rows[0]
    if (!row) return null
    if (!exploreUpdatedAtFresh(row.updated_at, now)) return null
    const payload = JSON.parse(String(row.payload)) as unknown
    if (!isDefenseList(payload)) return null
    const stamped = updatedAtMs(row.updated_at)
    if (stamped === null) return null
    remember(defenseMemory, key, payload, stamped)
    return payload
  } catch {
    return null
  }
}

async function writeDefense(key: string, payload: BlackDefenseList) {
  remember(defenseMemory, key, payload, cacheNow())
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

/**
 * Named lines at `play` from `fen`. The opening is kept only when the book
 * reaches it by exactly these moves. Children are that opening's own choices
 * (`Name: …`), then any book child still missing is requested and stored.
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
    if (stored) {
      return { ...stored, lines: await attachMissingSans(fen, play, stored.lines) }
    }

    const { position } = await fetchPosition(fen, ratings, play, ac.signal)
    const replySide = lastMover(fen, play) === 'white' ? 'black' : 'white'
    const collected: OpeningBranchLine[] = []
    for (const move of position.moves) {
      const line = lineFromMove(move, replySide, play)
      if (!line) continue
      if (alreadyListed(collected, line.name)) continue
      collected.push(line)
    }

    let complete = true
    let opening: ExplorerOpening | null = null
    let lines: OpeningBranchLine[] = []
    try {
      const book = await loadOpeningBook()
      const apiName = position.opening?.name ?? ''
      if (
        position.opening &&
        apiName &&
        openingReachedByPlay(book, apiName, play)
      ) {
        opening = position.opening
      } else {
        const exact = lineReachedByPlay(book, play)
        if (exact) opening = { eco: exact.eco, name: exact.name }
      }
      const resolvedParent = opening?.name ?? ''
      lines = collected.filter((line) =>
        isOpeningVariation(resolvedParent, line.name),
      )
      if (resolvedParent) {
        const branchKey = branchKeyFrom(fen, play)
        const missing = directChildren(book, resolvedParent).filter(
          (child) =>
            isOpeningVariation(resolvedParent, child.name) &&
            !alreadyListed(lines, child.name),
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
          const san = sanAfter(fen, play, rest[0] ?? '')
          try {
            const { position: reached } = await fetchPosition(
              fen,
              ratings,
              fullPlay,
              ac.signal,
            )
            const name = child.name
            if (alreadyListed(lines, name)) continue
            if (!isOpeningVariation(resolvedParent, name)) continue
            lines.push({
              name,
              eco: reached.opening?.eco || child.eco,
              san,
              play: fullPlay,
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
              san,
              play: fullPlay,
              white: 0,
              draws: 0,
              black: 0,
              averageRating: 0,
              mover,
            })
          }
        }
      }
    } catch (err) {
      if (ac.signal.aborted) throw err
      complete = false
      opening = null
      lines = []
    }

    const payload: OpeningBranch = { opening, lines }
    if (complete && !ac.signal.aborted) await writeStored(key, payload)
    return payload
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Black defenses from the starting position: named replies that are a
 * different opening from White's first move, not a variation of it.
 * Sorted by the client on Black's win rate.
 */
export async function loadBlackDefenses(
  ratings: readonly RatingBandId[],
  signal?: AbortSignal,
): Promise<BlackDefenseList> {
  const ac = new AbortController()
  const onAbort = () => ac.abort()
  if (signal) {
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  const key = defenseCacheKey(ratings)
  try {
    const stored = await readDefense(key)
    if (stored) return stored

    const { position } = await fetchPosition(START_FEN, ratings, '', ac.signal)
    const total = position.white + position.draws + position.black
    const byName = new Map<string, BlackDefense>()
    for (const move of position.moves) {
      if (ac.signal.aborted) break
      const parentName = move.opening?.name ?? ''
      const { position: after } = await fetchPosition(
        START_FEN,
        ratings,
        move.uci,
        ac.signal,
      )
      for (const reply of after.moves) {
        if (!reply.opening) continue
        const name = reply.opening.name
        if (parentName && name === parentName) continue
        if (isOpeningVariation(parentName, name)) continue
        const candidate: BlackDefense = {
          san: reply.san,
          eco: reply.opening.eco,
          name,
          white: reply.white,
          draws: reply.draws,
          black: reply.black,
          averageRating: reply.averageRating,
        }
        const existing = byName.get(name)
        if (existing && defenseGames(existing) >= defenseGames(candidate)) continue
        byName.set(name, candidate)
      }
    }

    if (ac.signal.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    const payload: BlackDefenseList = {
      total,
      defenses: [...byName.values()],
    }
    await writeDefense(key, payload)
    return payload
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
