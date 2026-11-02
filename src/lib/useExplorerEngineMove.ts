import { useEffect, useState } from 'react'
import { monthEnd, monthStart, monthsCovered } from '@/components/ExplorerDateRange'
import {
  loadExplorerRange,
  loadExplorerRatings,
  loadExplorerSpeeds,
  subscribeExplorerFilters,
} from '@/lib/explorerFilterPrefs'
import {
  bestExplorerEngineMove,
  worstWhiteExplorerMove,
} from '@/lib/explorerEngineMove'
import {
  fetchLichessExplorer,
  normalizeMonths,
  type ExplorerMonth,
  type ExplorerPosition,
  type ExplorerSpeed,
  type RatingBandId,
} from '@/lib/lichessExplorer'

export type ExplorerEngineTip = {
  fen: string
  /** `loading` until this fen's explorer reply arrives. */
  status: 'loading' | 'ready' | 'error'
  /** UCI of the explorer engine's best move for the side to move. */
  bestUci: string | null
  /** UCI of White's worst explorer-engine move. Null on Black's turn. */
  worstUci: string | null
}

const EMPTY: ExplorerEngineTip = {
  fen: '',
  status: 'loading',
  bestUci: null,
  worstUci: null,
}

let monthsPromise: Promise<ExplorerMonth[]> | null = null
const positionCache = new Map<string, ExplorerPosition>()

function explorerMonths(): Promise<ExplorerMonth[]> {
  if (!monthsPromise) {
    monthsPromise = fetch('/api/explorer-months', { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('months'))))
      .then((body: { months?: unknown }) =>
        normalizeMonths(
          Array.isArray(body.months)
            ? body.months.filter((month): month is string => typeof month === 'string')
            : [],
        ),
      )
      .catch((err: unknown) => {
        monthsPromise = null
        throw err
      })
  }
  return monthsPromise
}

/** Months the opener would send for the saved range. Empty means every month. */
async function selectedMonths(signal: AbortSignal): Promise<ExplorerMonth[]> {
  try {
    const available = await explorerMonths()
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (available.length === 0) return []
    const saved = loadExplorerRange()
    if (!saved) return []
    const fullFrom = monthStart(available[0])
    const fullTo = monthEnd(available[available.length - 1])
    const from = saved.from < fullFrom ? fullFrom : saved.from
    const to = saved.to > fullTo ? fullTo : saved.to
    if (from > to) return []
    const covered = monthsCovered(available, from, to)
    if (covered.length === available.length) return []
    return normalizeMonths(covered)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return []
  }
}

async function loadPosition(
  fen: string,
  ratings: readonly RatingBandId[],
  speeds: readonly ExplorerSpeed[],
  months: readonly ExplorerMonth[],
  signal: AbortSignal,
): Promise<ExplorerPosition> {
  const key = `${fen}|${ratings.join(',')}|${speeds.join(',')}|${months.join(',')}`
  const cached = positionCache.get(key)
  if (cached) return cached
  const position = await fetchLichessExplorer(fen, ratings, signal, { speeds, months })
  positionCache.set(key, position)
  return position
}

function sideToMove(fen: string): 'white' | 'black' {
  return fen.split(/\s+/)[1] === 'b' ? 'black' : 'white'
}

/**
 * Explorer engine recommendation for the current board.
 * While `status` is `loading`, callers should not fall back to Stockfish.
 */
export function useExplorerEngineMove(fen: string): ExplorerEngineTip {
  const [filterTick, setFilterTick] = useState(0)
  const [tip, setTip] = useState<ExplorerEngineTip>(EMPTY)

  useEffect(() => subscribeExplorerFilters(() => setFilterTick((tick) => tick + 1)), [])

  useEffect(() => {
    if (!fen) {
      setTip({ fen, status: 'ready', bestUci: null, worstUci: null })
      return
    }
    const controller = new AbortController()
    setTip({ fen, status: 'loading', bestUci: null, worstUci: null })
    const ratings = loadExplorerRatings()
    const speeds = loadExplorerSpeeds()
    const side = sideToMove(fen)

    void selectedMonths(controller.signal)
      .then((months) => loadPosition(fen, ratings, speeds, months, controller.signal))
      .then((position) => {
        if (controller.signal.aborted) return
        const best = bestExplorerEngineMove(position.moves, side)
        const worst = worstWhiteExplorerMove(position.moves, side)
        setTip({
          fen,
          status: 'ready',
          bestUci: best?.uci ?? null,
          worstUci: worst?.uci ?? null,
        })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setTip({ fen, status: 'error', bestUci: null, worstUci: null })
      })

    return () => controller.abort()
  }, [fen, filterTick])

  return tip.fen === fen ? tip : { fen, status: 'loading', bestUci: null, worstUci: null }
}
