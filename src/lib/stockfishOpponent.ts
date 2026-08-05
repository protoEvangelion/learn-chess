import { uciToSquares } from './uci'

/** Difficulty 1–8 → Stockfish UCI settings (approx.). */
export const STRENGTH_LEVELS = {
  1: { skill: 0, depth: 5, movetime: 50, multiPv: 4, eloHint: '~400' },
  2: { skill: 0, depth: 5, movetime: 100, multiPv: 4, eloHint: '~500' },
  3: { skill: 0, depth: 5, movetime: 150, multiPv: 4, eloHint: '~800' },
  4: { skill: 3, depth: 5, movetime: 200, multiPv: 4, eloHint: '~1100' },
  5: { skill: 7, depth: 5, movetime: 300, multiPv: 4, eloHint: '~1500' },
  6: { skill: 11, depth: 8, movetime: 400, multiPv: 4, eloHint: '~1900' },
  7: { skill: 16, depth: 13, movetime: 500, multiPv: 4, eloHint: '~2300' },
  8: { skill: 20, depth: 22, movetime: 1000, multiPv: 1, eloHint: '2800+' },
} as const

export type StrengthLevel = keyof typeof STRENGTH_LEVELS

export type EngineMove = {
  uci: string
  from: string
  to: string
  promotion?: string
}

export type BestMoveResult = {
  uci: string
  from: string
  to: string
  evalLabel: string
  /** Centipawns from White’s perspective (positive = White better). */
  whiteCp: number | null
  /** Mate in N from White’s perspective (positive = White mates). */
  whiteMate: number | null
  depth: number
  line: string
}

const ENGINE_URL = '/engines/stockfish-18-lite-single.js'

/** Full-strength analysis settings for best-move arrow / coach. */
const ANALYSIS = { skill: 20, depth: 18, multiPv: 1 } as const

function parseScore(infoLine: string): { cp: number | null; mate: number | null } {
  const mate = infoLine.match(/\bscore mate (-?\d+)\b/)
  if (mate) return { cp: null, mate: Number(mate[1]) }
  const cp = infoLine.match(/\bscore cp (-?\d+)\b/)
  if (cp) return { cp: Number(cp[1]), mate: null }
  return { cp: null, mate: null }
}

function toWhitePerspective(
  score: { cp: number | null; mate: number | null },
  sideToMove: 'w' | 'b',
): { whiteCp: number | null; whiteMate: number | null; evalLabel: string } {
  const flip = sideToMove === 'b' ? -1 : 1
  const whiteCp = score.cp == null ? null : score.cp * flip
  const whiteMate = score.mate == null ? null : score.mate * flip

  let evalLabel = '—'
  if (whiteMate != null) {
    evalLabel = whiteMate > 0 ? `M${whiteMate}` : `-M${Math.abs(whiteMate)}`
  } else if (whiteCp != null) {
    evalLabel = (whiteCp / 100).toFixed(2)
  }

  return { whiteCp, whiteMate, evalLabel }
}

function parseDepth(infoLine: string): number {
  const m = infoLine.match(/\bdepth (\d+)\b/)
  return m ? Number(m[1]) : 0
}

function parsePv(infoLine: string): string {
  const idx = infoLine.indexOf(' pv ')
  if (idx < 0) return ''
  return infoLine.slice(idx + 4).trim()
}

export class StockfishOpponent {
  private worker: Worker | null = null
  private ready = false
  private initPromise: Promise<void> | null = null
  private listeners = new Set<(line: string) => void>()
  private queue: Promise<unknown> = Promise.resolve()

  async init(): Promise<void> {
    if (this.ready) return
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise<void>((resolve, reject) => {
      try {
        this.worker = new Worker(ENGINE_URL)
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to start Stockfish worker'))
        return
      }

      this.worker.onmessage = (event: MessageEvent<string>) => {
        const line = String(event.data)
        for (const listener of this.listeners) listener(line)
      }

      this.worker.onerror = (event) => {
        reject(new Error(event.message || 'Stockfish worker error'))
      }

      this.waitFor((l) => l === 'uciok', 20000)
        .then(async () => {
          this.send('setoption name Threads value 1')
          this.send('setoption name Hash value 64')
          this.send('isready')
          await this.waitFor((l) => l === 'readyok', 20000)
          this.ready = true
          resolve()
        })
        .catch(reject)

      this.send('uci')
    })

    return this.initPromise
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd)
  }

  private waitFor(match: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.listeners.delete(onLine)
        reject(new Error('Stockfish timed out'))
      }, timeoutMs)

      const onLine = (line: string) => {
        if (!match(line)) return
        window.clearTimeout(timer)
        this.listeners.delete(onLine)
        resolve(line)
      }

      this.listeners.add(onLine)
    })
  }

  private collectUntilBestMove(timeoutMs: number): Promise<{
    bestmove: string
    lastInfo: string
  }> {
    return new Promise((resolve, reject) => {
      let lastInfo = ''
      const timer = window.setTimeout(() => {
        this.listeners.delete(onLine)
        reject(new Error('Stockfish timed out'))
      }, timeoutMs)

      const onLine = (line: string) => {
        if (line.startsWith('info ') && line.includes(' pv ')) {
          lastInfo = line
        }
        if (!line.startsWith('bestmove ')) return
        window.clearTimeout(timer)
        this.listeners.delete(onLine)
        resolve({ bestmove: line, lastInfo })
      }

      this.listeners.add(onLine)
    })
  }

  /** Weakened move for the opponent at a chosen strength. */
  getMove(fen: string, level: StrengthLevel): Promise<EngineMove> {
    return this.enqueue(async () => {
      await this.init()
      const cfg = STRENGTH_LEVELS[level]

      this.send('stop')
      this.send('ucinewgame')
      this.send('isready')
      await this.waitFor((l) => l === 'readyok', 10000)

      this.send(`setoption name Skill Level value ${cfg.skill}`)
      this.send(`setoption name MultiPV value ${cfg.multiPv}`)
      this.send('isready')
      await this.waitFor((l) => l === 'readyok', 10000)

      this.send(`position fen ${fen}`)

      const bestPromise = this.waitFor((l) => l.startsWith('bestmove '), 30000)
      this.send(`go depth ${cfg.depth} movetime ${cfg.movetime}`)

      const bestLine = await bestPromise
      const uci = bestLine.split(/\s+/)[1]
      if (!uci || uci === '(none)') {
        throw new Error('Engine returned no move')
      }

      const squares = uciToSquares(uci)
      if (!squares) throw new Error(`Bad engine move: ${uci}`)

      return {
        uci,
        from: squares.from,
        to: squares.to,
        promotion: uci.length >= 5 ? uci[4] : undefined,
      }
    })
  }

  /** Full-strength local analysis for the green-arrow best move. */
  getBestMove(fen: string, signal?: AbortSignal): Promise<BestMoveResult> {
    return this.enqueue(async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await this.init()

      const stopOnAbort = () => this.send('stop')
      signal?.addEventListener('abort', stopOnAbort)

      try {
        this.send('stop')
        this.send('ucinewgame')
        this.send('isready')
        await this.waitFor((l) => l === 'readyok', 10000)
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

        // Reset any weakened opponent settings before analyzing.
        this.send(`setoption name Skill Level value ${ANALYSIS.skill}`)
        this.send('setoption name UCI_LimitStrength value false')
        this.send(`setoption name MultiPV value ${ANALYSIS.multiPv}`)
        this.send('isready')
        await this.waitFor((l) => l === 'readyok', 10000)
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

        this.send(`position fen ${fen}`)

        const resultPromise = this.collectUntilBestMove(45000)
        // Depth-only so lite WASM isn’t cut off early by a short movetime.
        this.send(`go depth ${ANALYSIS.depth}`)

        const { bestmove, lastInfo } = await resultPromise
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

        const uci = bestmove.split(/\s+/)[1]
        if (!uci || uci === '(none)') {
          throw new Error('Engine returned no best move')
        }

        const squares = uciToSquares(uci)
        if (!squares) throw new Error(`Bad engine move: ${uci}`)

        const line = parsePv(lastInfo) || uci
        const sideToMove = (fen.split(/\s+/)[1] === 'b' ? 'b' : 'w') as 'w' | 'b'
        const raw = lastInfo ? parseScore(lastInfo) : { cp: null, mate: null }
        const { whiteCp, whiteMate, evalLabel } = toWhitePerspective(raw, sideToMove)

        return {
          uci,
          from: squares.from,
          to: squares.to,
          evalLabel,
          whiteCp,
          whiteMate,
          depth: lastInfo ? parseDepth(lastInfo) : ANALYSIS.depth,
          line,
        }
      } finally {
        signal?.removeEventListener('abort', stopOnAbort)
      }
    })
  }

  dispose() {
    this.send('quit')
    this.worker?.terminate()
    this.worker = null
    this.ready = false
    this.initPromise = null
    this.listeners.clear()
  }
}

export const stockfishOpponent = new StockfishOpponent()
