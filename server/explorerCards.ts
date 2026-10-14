import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { ExplorerSpeed, RatingBandId } from '../src/lib/lichessExplorer.js'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export type CardMove = {
  uci: string
  san: string
  white: number
  draws: number
  black: number
}

export type CardPosition = {
  white: number
  draws: number
  black: number
  moves: CardMove[]
}

type Pending = {
  resolve: (position: CardPosition) => void
  reject: (err: Error) => void
}

let child: ChildProcessWithoutNullStreams | null = null
let queue: Pending[] = []

function cardsDir(root = process.cwd()): string {
  return path.join(root, '.data', 'explorer-cards')
}

/** Months whose card file finished. `YYYY-MM`, earliest first. */
export function listCardMonths(root = process.cwd()): string[] {
  const dir = cardsDir(root)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.done'))
    .map((name) => name.slice(0, -'.done'.length))
    .filter((month) => MONTH_RE.test(month) && existsSync(path.join(dir, `${month}.redb`)))
    .sort()
}

function readerBin(root = process.cwd()): string {
  return path.join(root, 'explorer-rs', 'target', 'fast', 'explorer-build')
}

function failQueue(err: Error) {
  const pending = queue
  queue = []
  for (const item of pending) item.reject(err)
}

function stopReader() {
  const current = child
  child = null
  if (!current || current.killed || current.exitCode !== null) return
  current.kill()
}

/** The card file allows one opener. A reload can leave the previous opener alive. */
function releaseStaleReaders() {
  const own = child?.pid
  let text = ''
  try {
    text = execFileSync('ps', ['-eo', 'pid,cmd'], { encoding: 'utf8' })
  } catch {
    return
  }
  const pids: number[] = []
  for (const line of text.split('\n')) {
    if (!line.includes('--pass cards-serve')) continue
    const pid = Number(line.trim().split(/\s+/, 1)[0])
    if (!pid || pid === own || pid === process.pid) continue
    pids.push(pid)
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
  const deadline = Date.now() + 500
  while (Date.now() < deadline && pids.some((pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })) {
    execFileSync('sleep', ['0.05'])
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}

function ensureReader() {
  if (child && child.exitCode === null && !child.killed) return
  const bin = readerBin()
  if (!existsSync(bin)) {
    throw new Error('Card reader is not built. Run the explorer-rs fast build.')
  }
  releaseStaleReaders()
  child = spawn(bin, ['--pass', 'cards-serve', '--data', cardsDir()], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    const pending = queue.shift()
    if (!pending) return
    try {
      const body = JSON.parse(line) as CardPosition & { error?: string }
      if (body.error) {
        pending.reject(new Error(body.error))
        return
      }
      pending.resolve(body)
    } catch (err) {
      pending.reject(err instanceof Error ? err : new Error('card reader returned junk'))
    }
  })
  child.on('exit', () => {
    child = null
    failQueue(new Error('card reader stopped'))
  })
}

const hot = (import.meta as { hot?: { dispose: (cb: () => void) => void } }).hot
hot?.dispose(() => {
  stopReader()
  failQueue(new Error('card reader restarted'))
})

/**
 * One board from the card files. The Rust process stays open because the
 * file is hundreds of gigabytes and opening it on every click would be slow.
 */
export function queryCardStore(input: {
  fen: string
  play: string
  speeds: readonly ExplorerSpeed[]
  ratings: readonly RatingBandId[]
  months: readonly string[]
}): Promise<CardPosition> {
  ensureReader()
  const line = [
    'Q',
    input.fen,
    input.play,
    input.speeds.join(','),
    input.ratings.join(','),
    input.months.join(','),
  ].join('\t')
  return new Promise((resolve, reject) => {
    queue.push({ resolve, reject })
    child?.stdin.write(`${line}\n`, (err) => {
      if (!err) return
      const pending = queue.pop()
      pending?.reject(err)
    })
  })
}
