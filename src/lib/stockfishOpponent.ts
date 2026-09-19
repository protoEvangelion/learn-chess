import { uciToSquares } from './uci'

/**
 * Difficulty 1–8. Elo hints match Lichess AI.
 *
 * Official Stockfish Skill Level min is 0 (~1100). Lichess gets ~400 at level 1
 * with Fairy-Stockfish skill −9. We search at full strength (MultiPV) then pick
 * with that virtual skill in `pickSkillMove` so 1–3 are actually weaker than 4.
 */
export const STRENGTH_LEVELS = {
  1: { skill: -9, depth: 5, multiPv: 8, eloHint: '~400' },
  2: { skill: -5, depth: 5, multiPv: 6, eloHint: '~500' },
  3: { skill: -1, depth: 5, multiPv: 4, eloHint: '~800' },
  4: { skill: 3, depth: 5, multiPv: 4, eloHint: '~1100' },
  5: { skill: 7, depth: 5, multiPv: 4, eloHint: '~1500' },
  6: { skill: 11, depth: 8, multiPv: 4, eloHint: '~1900' },
  7: { skill: 15, depth: 13, multiPv: 4, eloHint: '~2300' },
  8: { skill: 20, depth: 22, multiPv: 1, eloHint: '2800+' },
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

/** MultiPV analysis for coach / arrow (ranked best → 3rd). */
export type AnalysisResult = {
  lines: BestMoveResult[]
}

const ENGINE_URL = '/engines/stockfish-18-lite-single.js'

/** Full-strength analysis settings for best-move arrow / coach. */
const ANALYSIS = { skill: 20, depth: 18, multiPv: 3 } as const

/** Faster single-PV eval for post-game ply tagging. */
export const REVIEW_ANALYSIS = { skill: 20, depth: 12, multiPv: 1 } as const

export type AnalyzeOpts = {
  depth?: number
  multiPv?: number
}

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

function parseMultiPv(infoLine: string): number {
  const m = infoLine.match(/\bmultipv (\d+)\b/)
  return m ? Number(m[1]) : 1
}

/** Side-to-move score in cp (mates mapped to a large magnitude). */
function pickScore(infoLine: string): number {
  const { cp, mate } = parseScore(infoLine)
  if (mate != null) return mate > 0 ? 100000 - mate : -100000 - mate
  return cp ?? 0
}

export type SkillCandidate = { uci: string; score: number }

/**
 * Stockfish `Skill::pick_best` (allows skill < 0, which official UCI cannot).
 * Higher `skill` → more likely to keep the top line.
 */
export function pickSkillMove(
  lines: SkillCandidate[],
  skill: number,
): string | null {
  if (lines.length === 0) return null
  if (skill >= 20 || lines.length === 1) return lines[0].uci

  let topScore = -Infinity
  let minScore = Infinity
  for (const line of lines) {
    topScore = Math.max(topScore, line.score)
    minScore = Math.min(minScore, line.score)
  }

  const pawn = 100
  const delta = Math.max(1, Math.min(topScore - minScore, pawn))
  const weakness = 120 - 2 * skill
  if (weakness <= 1) return lines[0].uci

  let bestUci = lines[0].uci
  let maxScore = -Infinity
  for (const line of lines) {
    const rand = Math.floor(Math.random() * weakness)
    const push = (weakness * (topScore - line.score) + delta * rand) / 128
    const adjusted = line.score + push
    if (adjusted >= maxScore) {
      maxScore = adjusted
      bestUci = line.uci
    }
  }
  return bestUci
}

function infoToLine(
  infoLine: string,
  fen: string,
  fallbackUci?: string,
): BestMoveResult | null {
  const pv = parsePv(infoLine)
  const uci = (pv.split(/\s+/)[0] || fallbackUci || '').trim()
  if (!uci || uci === '(none)') return null
  const squares = uciToSquares(uci)
  if (!squares) return null
  const sideToMove = (fen.split(/\s+/)[1] === 'b' ? 'b' : 'w') as 'w' | 'b'
  const raw = parseScore(infoLine)
  const { whiteCp, whiteMate, evalLabel } = toWhitePerspective(raw, sideToMove)
  return {
    uci,
    from: squares.from,
    to: squares.to,
    evalLabel,
    whiteCp,
    whiteMate,
    depth: parseDepth(infoLine) || ANALYSIS.depth,
    line: pv || uci,
  }
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
    /** Latest info line keyed by multipv index (1-based). */
    infoByMultiPv: Map<number, string>
  }> {
    return new Promise((resolve, reject) => {
      const infoByMultiPv = new Map<number, string>()
      const timer = window.setTimeout(() => {
        this.listeners.delete(onLine)
        reject(new Error('Stockfish timed out'))
      }, timeoutMs)

      const onLine = (line: string) => {
        if (line.startsWith('info ') && line.includes(' pv ')) {
          infoByMultiPv.set(parseMultiPv(line), line)
        }
        if (!line.startsWith('bestmove ')) return
        window.clearTimeout(timer)
        this.listeners.delete(onLine)
        resolve({ bestmove: line, infoByMultiPv })
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

      // Full-strength search; virtual skill (including negatives) is applied in JS.
      this.send('setoption name Skill Level value 20')
      this.send('setoption name UCI_LimitStrength value false')
      this.send(`setoption name MultiPV value ${cfg.multiPv}`)
      this.send('isready')
      await this.waitFor((l) => l === 'readyok', 10000)

      this.send(`position fen ${fen}`)

      const resultPromise = this.collectUntilBestMove(30000)
      this.send(`go depth ${cfg.depth}`)

      const { bestmove, infoByMultiPv } = await resultPromise
      const bestUci = bestmove.split(/\s+/)[1]
      if (!bestUci || bestUci === '(none)') {
        throw new Error('Engine returned no move')
      }

      const candidates: SkillCandidate[] = []
      for (let i = 1; i <= cfg.multiPv; i++) {
        const info = infoByMultiPv.get(i)
        if (!info) continue
        const parsed = infoToLine(info, fen, i === 1 ? bestUci : undefined)
        if (!parsed) continue
        candidates.push({ uci: parsed.uci, score: pickScore(info) })
      }

      const uci =
        cfg.skill >= 20
          ? bestUci
          : (pickSkillMove(candidates, cfg.skill) ?? bestUci)

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

  /** Full-strength MultiPV analysis (up to 3 lines) for arrow / coach. */
  getBestMove(
    fen: string,
    signal?: AbortSignal,
    opts?: AnalyzeOpts,
  ): Promise<AnalysisResult> {
    const depth = opts?.depth ?? ANALYSIS.depth
    const multiPv = opts?.multiPv ?? ANALYSIS.multiPv
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
        this.send(`setoption name MultiPV value ${multiPv}`)
        this.send('isready')
        await this.waitFor((l) => l === 'readyok', 10000)
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

        this.send(`position fen ${fen}`)

        const resultPromise = this.collectUntilBestMove(45000)
        this.send(`go depth ${depth}`)

        const { bestmove, infoByMultiPv } = await resultPromise
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

        const bestUci = bestmove.split(/\s+/)[1]
        const lines: BestMoveResult[] = []
        const maxPv = Math.max(multiPv, ...infoByMultiPv.keys(), 1)
        for (let i = 1; i <= maxPv && lines.length < multiPv; i++) {
          const info = infoByMultiPv.get(i)
          if (!info) continue
          const parsed = infoToLine(info, fen, i === 1 ? bestUci : undefined)
          if (parsed) lines.push(parsed)
        }

        if (lines.length === 0 && bestUci && bestUci !== '(none)') {
          const squares = uciToSquares(bestUci)
          if (squares) {
            lines.push({
              uci: bestUci,
              from: squares.from,
              to: squares.to,
              evalLabel: '—',
              whiteCp: null,
              whiteMate: null,
              depth,
              line: bestUci,
            })
          }
        }

        if (lines.length === 0) {
          throw new Error('Engine returned no best move')
        }

        return { lines }
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
