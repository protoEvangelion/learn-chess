import { useEffect, useState, type FC } from 'react'
import { RatingBandMultiSelect } from '@/components/RatingBandMultiSelect'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DEFAULT_RATING_BAND,
  explorerGames,
  fetchLichessExplorer,
  isRatingBandId,
  normalizeRatings,
  openingExplorerApiUrl,
  type ExplorerMove,
  type ExplorerPosition,
  type RatingBandId,
} from '@/lib/lichessExplorer'

type Props = {
  fen: string
}

const DEBOUNCE_MS = 250
const CHILD_CONCURRENCY = 3

type OpeningLine = {
  name: string
  eco: string
  white: number
  draws: number
  black: number
  averageRating: number
}

type OpeningGroup = {
  san: string
  uci: string
  white: number
  draws: number
  black: number
  averageRating: number
  lines: OpeningLine[]
}

type Snapshot = {
  key: string
  status: 'ready' | 'error'
  error: string | null
  total: number
  groups: OpeningGroup[]
}

function percentLabel(white: number, draws: number, black: number) {
  const total = white + draws + black
  const pct = (value: number) =>
    total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0%'
  return `White ${pct(white)} · Draw ${pct(draws)} · Black ${pct(black)}`
}

function shareLabel(part: number, total: number) {
  if (total <= 0) return '0%'
  return `${((part / total) * 100).toFixed(1)}%`
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next
        next += 1
        results[index] = await fn(items[index])
      }
    },
  )
  await Promise.all(workers)
  return results
}

function linesFromReplies(moves: ExplorerMove[]): OpeningLine[] {
  const byName = new Map<string, OpeningLine>()
  for (const move of moves) {
    if (!move.opening) continue
    const key = move.opening.name
    const prev = byName.get(key)
    if (!prev) {
      byName.set(key, {
        name: move.opening.name,
        eco: move.opening.eco,
        white: move.white,
        draws: move.draws,
        black: move.black,
        averageRating: move.averageRating,
      })
      continue
    }
    const prevGames = explorerGames(prev)
    const addGames = explorerGames(move)
    const combined = prevGames + addGames
    prev.white += move.white
    prev.draws += move.draws
    prev.black += move.black
    prev.averageRating =
      combined > 0
        ? Math.round(
            (prev.averageRating * prevGames + move.averageRating * addGames) /
              combined,
          )
        : prev.averageRating
  }
  return [...byName.values()].sort(
    (a, b) => explorerGames(b) - explorerGames(a),
  )
}

async function loadGroups(
  fen: string,
  ratings: RatingBandId[],
  signal: AbortSignal,
): Promise<{ total: number; groups: OpeningGroup[] }> {
  const root: ExplorerPosition = await fetchLichessExplorer(fen, ratings, signal, {
    moves: 8,
  })
  const groups = await mapLimit(root.moves, CHILD_CONCURRENCY, async (move) => {
    let lines: OpeningLine[] = []
    try {
      const child = await fetchLichessExplorer(fen, ratings, signal, {
        play: move.uci,
        moves: 12,
      })
      lines = linesFromReplies(child.moves)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      lines = []
    }
    return {
      san: move.san,
      uci: move.uci,
      white: move.white,
      draws: move.draws,
      black: move.black,
      averageRating: move.averageRating,
      lines,
    }
  })
  return { total: explorerGames(root), groups }
}

function ResultBar({
  white,
  draws,
  black,
}: {
  white: number
  draws: number
  black: number
}) {
  const games = white + draws + black
  if (games <= 0) return null
  const percents = percentLabel(white, draws, black)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="rating-band-bar"
          tabIndex={0}
          role="img"
          aria-label={percents}
        >
          <span className="rating-band-bar-white" style={{ flexGrow: white }} />
          <span className="rating-band-bar-draw" style={{ flexGrow: draws }} />
          <span className="rating-band-bar-black" style={{ flexGrow: black }} />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {percents}
      </TooltipContent>
    </Tooltip>
  )
}

function AverageRating({ value }: { value: number }) {
  if (value <= 0) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="rating-band-avg" tabIndex={0}>
          avg {value.toLocaleString('en-US')}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        Average rating of the players who played that move
      </TooltipContent>
    </Tooltip>
  )
}

export const ExploreOpenings: FC<Props> = ({ fen }) => {
  const [ratings, setRatings] = useState<RatingBandId[]>([DEFAULT_RATING_BAND])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const selected = normalizeRatings(ratings)
  const ratingKey = selected.join(',')
  const requestKey = `${ratingKey}\n${fen}`
  const requestUrl = openingExplorerApiUrl(fen, selected, { moves: 8 })
  const current = snapshot && snapshot.key === requestKey ? snapshot : null
  const status = current?.status ?? 'loading'
  const groups = current?.status === 'ready' ? current.groups : null
  const total = current?.status === 'ready' ? current.total : 0
  const error = current?.status === 'error' ? current.error : null

  useEffect(() => {
    const controller = new AbortController()
    const key = requestKey
    const bands = normalizeRatings(
      ratingKey.split(',').filter((id): id is RatingBandId => isRatingBandId(id)),
    )
    const timer = window.setTimeout(() => {
      void loadGroups(fen, bands, controller.signal)
        .then((loaded) => {
          if (controller.signal.aborted) return
          setSnapshot({
            key,
            status: 'ready',
            error: null,
            total: loaded.total,
            groups: loaded.groups,
          })
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          if (err instanceof DOMException && err.name === 'AbortError') return
          setSnapshot({
            key,
            status: 'error',
            error: err instanceof Error ? err.message : 'Lichess explorer failed.',
            total: 0,
            groups: [],
          })
        })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [fen, ratingKey, requestKey])

  return (
    <section
      className="rating-band"
      aria-label="Opening explorer"
      aria-busy={status === 'loading'}
      data-explorer-url={requestUrl}
      data-ratings={selected.join(',')}
    >
      <div className="rating-band-head">
        <h3 className="rating-band-title" id="explore-heading">
          Openings
        </h3>
        <RatingBandMultiSelect value={selected} onChange={setRatings} />
      </div>
      <p className="rating-band-note">
        Lichess combines the selected rating bands. Each first move shows its
        share of games, with the named openings under it.
      </p>

      {status === 'loading' ? (
        <p className="rating-band-note" role="status">
          Loading openings…
        </p>
      ) : null}

      {status === 'error' ? (
        <p className="rating-band-note is-error" role="alert">
          {error ?? 'Lichess explorer failed.'}
        </p>
      ) : null}

      {groups && groups.length === 0 ? (
        <p className="rating-band-note" role="status">
          No rated games in these bands reached this position.
        </p>
      ) : null}

      {groups && groups.length > 0 ? (
        <TooltipProvider delayDuration={250}>
          <ul className="explore-groups">
            {groups.map((group) => {
              const games = explorerGames(group)
              return (
                <li key={group.uci} className="explore-group">
                  <div className="rating-band-move-row">
                    <span className="rating-band-san">{group.san}</span>
                    <span className="explore-pct">{shareLabel(games, total)}</span>
                  </div>
                  {group.averageRating > 0 ? (
                    <p className="rating-band-games">
                      <AverageRating value={group.averageRating} />
                    </p>
                  ) : null}
                  <ResultBar
                    white={group.white}
                    draws={group.draws}
                    black={group.black}
                  />
                  {group.lines.length > 0 ? (
                    <ul className="explore-lines">
                      {group.lines.map((line) => {
                        const lineGames = explorerGames(line)
                        return (
                          <li key={line.name} className="explore-line">
                            <div className="rating-band-move-row">
                              <span className="explore-line-name">
                                {line.eco ? `${line.eco} ` : ''}
                                {line.name}
                              </span>
                              <span className="explore-pct">
                                {shareLabel(lineGames, total)}
                              </span>
                            </div>
                            <ResultBar
                              white={line.white}
                              draws={line.draws}
                              black={line.black}
                            />
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="rating-band-note">
                      Lichess did not name a line under {group.san} for these bands.
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </TooltipProvider>
      ) : null}
    </section>
  )
}
