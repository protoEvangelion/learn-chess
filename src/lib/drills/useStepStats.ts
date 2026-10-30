import { useEffect, useState } from 'react'
import { monthEnd, monthStart, monthsCovered } from '@/components/ExplorerDateRange'
import {
  loadExplorerRange,
  loadExplorerRatings,
  loadExplorerSpeeds,
  subscribeExplorerFilters,
} from '@/lib/explorerFilterPrefs'
import {
  explorerGames,
  fetchLichessExplorer,
  normalizeMonths,
  type ExplorerMonth,
  type ExplorerPosition,
  type ExplorerSpeed,
  type RatingBandId,
} from '@/lib/lichessExplorer'

export type DrillStepStats = {
  /** "Played 18.2%" or "Rare in these filters". Null while the opener is loading, or when this step has no book move. */
  play: string | null
  /** Same split as the opener tip: White · Draw · Black. */
  results: string | null
  /** Computer's best move in SAN, or a short reason we don't have one. */
  computer: string | null
  explorer: 'idle' | 'loading' | 'ready' | 'error'
  computerState: 'idle' | 'loading' | 'ready' | 'error'
}

/** One line under the drill note. Empty when nothing has been asked yet. */
export function formatStepStats(stats: DrillStepStats): string {
  const bits: string[] = []
  if (stats.explorer === 'loading') bits.push('Reading the opener…')
  else if (stats.explorer === 'error') bits.push('Opener unavailable')
  else if (stats.play && stats.results) bits.push(`${stats.play} · ${stats.results}`)
  else if (stats.play) bits.push(stats.play)

  if (stats.computerState === 'loading') bits.push('Computer: …')
  else if (stats.computerState === 'error') bits.push('Computer: unavailable')
  else if (stats.computer) bits.push(`Computer: ${stats.computer}`)

  return bits.join(' · ')
}

const EMPTY: DrillStepStats = {
  play: null,
  results: null,
  computer: null,
  explorer: 'idle',
  computerState: 'idle',
}

let monthsPromise: Promise<ExplorerMonth[]> | null = null
const positionCache = new Map<string, ExplorerPosition>()
const computerCache = new Map<string, string>()

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

/** Months the opener would send for the saved calendar range. Empty means every month. */
async function selectedMonths(signal: AbortSignal): Promise<ExplorerMonth[]> {
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
}

function playLabel(games: number, parent: number): string {
  if (parent <= 0 || games <= 0) return 'Rare in these filters'
  const share = games / parent
  const shown = (share * 100).toFixed(1)
  const pct = share > 0 && shown === '0.0' ? '<0.1%' : `${shown}%`
  return `Played ${pct}`
}

/** Same wording as the opener's result tip. */
function resultsLabel(move: { white: number; draws: number; black: number }): string | null {
  const total = explorerGames(move)
  if (total <= 0) return null
  const pct = (value: number) => `${((value / total) * 100).toFixed(1)}%`
  return `White ${pct(move.white)} · Draw ${pct(move.draws)} · Black ${pct(move.black)}`
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
  const position = await fetchLichessExplorer(fen, ratings, signal, {
    speeds,
    months,
  })
  positionCache.set(key, position)
  return position
}

async function loadComputer(fen: string, signal: AbortSignal): Promise<string> {
  const cached = computerCache.get(fen)
  if (cached) return cached
  const response = await fetch(`/api/cloud-eval?fen=${encodeURIComponent(fen)}`, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (response.status === 404) {
    computerCache.set(fen, 'not in the cloud')
    return 'not in the cloud'
  }
  if (!response.ok) throw new Error('computer')
  const body = (await response.json()) as { san?: unknown }
  const san = typeof body.san === 'string' && body.san.trim() ? body.san.trim() : 'not in the cloud'
  computerCache.set(fen, san)
  return san
}

/**
 * Live opener numbers for the book move about to be played, plus the
 * computer's best move in this position. Filters are the ones saved by the
 * opener (ratings, speeds, months).
 */
export function useDrillStepStats(options: {
  fen: string
  san: string | null
  enabled: boolean
}): DrillStepStats {
  const { fen, san, enabled } = options
  const [filterTick, setFilterTick] = useState(0)
  const [stats, setStats] = useState<DrillStepStats>(EMPTY)

  useEffect(() => subscribeExplorerFilters(() => setFilterTick((tick) => tick + 1)), [])

  useEffect(() => {
    if (!enabled || !fen) return
    const controller = new AbortController()
    const sanNow = san
    setStats({
      play: null,
      results: null,
      computer: null,
      explorer: sanNow ? 'loading' : 'idle',
      computerState: 'loading',
    })

    const ratings = loadExplorerRatings()
    const speeds = loadExplorerSpeeds()

    void loadComputer(fen, controller.signal)
      .then((computer) => {
        if (controller.signal.aborted) return
        setStats((prev) => ({ ...prev, computer, computerState: 'ready' }))
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setStats((prev) => ({ ...prev, computer: null, computerState: 'error' }))
      })

    if (sanNow) {
      void selectedMonths(controller.signal)
        .then((months) => loadPosition(fen, ratings, speeds, months, controller.signal))
        .then((position) => {
          if (controller.signal.aborted) return
          const move = position.moves.find((item) => item.san === sanNow)
          const parent = explorerGames(position)
          if (!move) {
            setStats((prev) => ({
              ...prev,
              play: 'Rare in these filters',
              results: null,
              explorer: 'ready',
            }))
            return
          }
          setStats((prev) => ({
            ...prev,
            play: playLabel(explorerGames(move), parent),
            results: resultsLabel(move),
            explorer: 'ready',
          }))
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          if (err instanceof DOMException && err.name === 'AbortError') return
          setStats((prev) => ({ ...prev, play: null, results: null, explorer: 'error' }))
        })
    }

    return () => controller.abort()
  }, [enabled, fen, san, filterTick])

  return stats
}
