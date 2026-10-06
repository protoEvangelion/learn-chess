import { Chess } from 'chess.js'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Lichess opening names and move lists. Fetched at runtime and cached under
 * `.data/` so the tree is not committed. Used only to open a named branch the
 * explorer walk did not already name.
 */
const BOOK_FILES = ['a', 'b', 'c', 'd', 'e'] as const
const BOOK_VERSION = 1
const CACHE_PATH = path.join(process.cwd(), '.data', 'opening-book.json')

const SOURCES = [
  (file: string) =>
    `https://raw.githubusercontent.com/lichess-org/chess-openings/master/${file}.tsv`,
  (file: string) =>
    `https://cdn.jsdelivr.net/gh/lichess-org/chess-openings@master/${file}.tsv`,
]

export type BookLine = {
  eco: string
  name: string
  uci: string[]
  /** Position key after each ply, clocks omitted. */
  keys: string[]
}

type BookCache = {
  version: number
  lines: BookLine[]
  children: Record<string, number[]>
}

let loading: Promise<BookCache> | null = null

export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

function parseTsv(text: string): Array<{ eco: string; name: string; pgn: string }> {
  const rows: Array<{ eco: string; name: string; pgn: string }> = []
  const lines = text.split(/\r?\n/)
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) continue
    const [eco = '', name = '', pgn = ''] = line.split('\t')
    if (!name || !pgn) continue
    rows.push({ eco, name, pgn })
  }
  return rows
}

function lineFromPgn(eco: string, name: string, pgn: string): BookLine | null {
  try {
    const chess = new Chess()
    chess.loadPgn(pgn, { strict: false })
    const verbose = chess.history({ verbose: true })
    if (verbose.length === 0) return null
    const replay = new Chess()
    const uci: string[] = []
    const keys: string[] = []
    for (const move of verbose) {
      const played = replay.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion,
      })
      if (!played) return null
      uci.push(`${move.from}${move.to}${move.promotion ?? ''}`)
      keys.push(positionKey(replay.fen()))
    }
    return { eco, name, uci, keys }
  } catch {
    return null
  }
}

function parentName(name: string, names: readonly string[]): string {
  let best = ''
  for (const other of names) {
    if (other === name || other.length >= name.length || other.length <= best.length) {
      continue
    }
    if (name.startsWith(`${other}: `) || name.startsWith(`${other}, `)) best = other
  }
  return best
}

function buildCache(lines: BookLine[]): BookCache {
  const names = lines.map((line) => line.name)
  const children: Record<string, number[]> = {}
  lines.forEach((line, index) => {
    const parent = parentName(line.name, names)
    if (!parent) return
    const list = children[parent] ?? []
    list.push(index)
    children[parent] = list
  })
  return { version: BOOK_VERSION, lines, children }
}

async function downloadBook(): Promise<string[]> {
  let lastError: Error | null = null
  for (const source of SOURCES) {
    try {
      const texts = await Promise.all(
        BOOK_FILES.map(async (file) => {
          const res = await fetch(source(file), {
            headers: { Accept: 'text/tab-separated-values, text/plain' },
          })
          if (!res.ok) throw new Error(`opening book ${file}.tsv returned ${res.status}`)
          return res.text()
        }),
      )
      return texts
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('opening book download failed')
    }
  }
  throw lastError ?? new Error('opening book download failed')
}

function readDiskCache(): BookCache | null {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as BookCache
    if (parsed.version !== BOOK_VERSION || !Array.isArray(parsed.lines)) return null
    return parsed
  } catch {
    return null
  }
}

function writeDiskCache(cache: BookCache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache))
  } catch {
    // Cache is optional. The in-memory copy still serves this process.
  }
}

async function loadCache(): Promise<BookCache> {
  const disk = readDiskCache()
  if (disk) return disk
  const texts = await downloadBook()
  const lines: BookLine[] = []
  for (const text of texts) {
    for (const row of parseTsv(text)) {
      const line = lineFromPgn(row.eco, row.name, row.pgn)
      if (line) lines.push(line)
    }
  }
  if (lines.length < 1000) throw new Error('opening book parsed too few lines')
  const cache = buildCache(lines)
  writeDiskCache(cache)
  return cache
}

export function loadOpeningBook(): Promise<BookCache> {
  if (!loading) {
    loading = loadCache().catch((err) => {
      loading = null
      throw err
    })
  }
  return loading
}

export function directChildren(book: BookCache, parent: string): BookLine[] {
  const indexes = book.children[parent] ?? []
  return indexes.map((index) => book.lines[index]).filter(Boolean)
}

/** UCI moves that continue `line` after `branchKey`. Empty when this line is the branch. */
export function movesAfter(line: BookLine, branchKey: string): string[] | null {
  const index = line.keys.indexOf(branchKey)
  if (index < 0) return null
  return line.uci.slice(index + 1)
}

function playUci(play: string): string[] {
  return play.split(',').filter(Boolean)
}

function sameUci(line: BookLine, uci: readonly string[]): boolean {
  return (
    line.uci.length === uci.length &&
    line.uci.every((move, index) => move === uci[index])
  )
}

/** Book line whose move list is exactly `play`, when one exists. */
export function lineReachedByPlay(book: BookCache, play: string): BookLine | null {
  const uci = playUci(play)
  if (uci.length === 0) return null
  return book.lines.find((line) => sameUci(line, uci)) ?? null
}

/** True when a book line of this name is reached by exactly these moves. */
export function openingReachedByPlay(
  book: BookCache,
  name: string,
  play: string,
): boolean {
  const uci = playUci(play)
  if (!name || uci.length === 0) return false
  return book.lines.some((line) => line.name === name && sameUci(line, uci))
}

export function branchKeyFrom(fen: string, play: string): string {
  const chess = new Chess(fen)
  for (const uci of play.split(',').filter(Boolean)) {
    const from = uci.slice(0, 2)
    const to = uci.slice(2, 4)
    const promotion = uci[4]
    const move = chess.move({
      from,
      to,
      promotion: promotion || undefined,
    })
    if (!move) throw new Error(`illegal explorer play ${uci}`)
  }
  return positionKey(chess.fen())
}
