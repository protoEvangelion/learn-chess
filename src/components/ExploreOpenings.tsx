import { useEffect, useRef, useState, type FC, type SyntheticEvent } from 'react'
import { RatingBandMultiSelect } from '@/components/RatingBandMultiSelect'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DEFAULT_RATING_BAND,
  EXPLORER_MOVE_CAP,
  explorerGames,
  fetchLichessExplorer,
  fetchOpeningBranch,
  isRatingBandId,
  normalizeRatings,
  openingExplorerApiUrl,
  sideWinRate,
  sortBranchLines,
  sortBySan,
  type ExplorerOpening,
  type OpeningBranchLine,
  type RatingBandId,
} from '@/lib/lichessExplorer'

type Props = {
  fen: string
}

const DEBOUNCE_MS = 250

type OpeningGroup = {
  san: string
  uci: string
  white: number
  draws: number
  black: number
  averageRating: number
  opening: ExplorerOpening | null
}

type Snapshot = {
  key: string
  status: 'ready' | 'error'
  error: string | null
  total: number
  groups: OpeningGroup[]
}

type BranchStatus = 'idle' | 'loading' | 'ready' | 'error'

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

function bandsFromKey(ratingKey: string): RatingBandId[] {
  return normalizeRatings(
    ratingKey.split(',').filter((id): id is RatingBandId => isRatingBandId(id)),
  )
}

function lineLabel(name: string, parentName: string) {
  if (parentName && name.startsWith(`${parentName}: `)) {
    return name.slice(parentName.length + 2)
  }
  if (parentName && name.startsWith(`${parentName}, `)) {
    return name.slice(parentName.length + 2)
  }
  return name
}

async function loadGroups(
  fen: string,
  ratings: RatingBandId[],
  signal: AbortSignal,
): Promise<{ total: number; groups: OpeningGroup[] }> {
  const root = await fetchLichessExplorer(fen, ratings, signal, {
    moves: EXPLORER_MOVE_CAP,
  })
  const groups = sortBySan(
    root.moves.map((move) => ({
      san: move.san,
      uci: move.uci,
      white: move.white,
      draws: move.draws,
      black: move.black,
      averageRating: move.averageRating,
      opening: move.opening,
    })),
  )
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

function OpeningDisclosure({
  group,
  total,
  fen,
  ratingKey,
}: {
  group: OpeningGroup
  total: number
  fen: string
  ratingKey: string
}) {
  const [status, setStatus] = useState<BranchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<ExplorerOpening | null>(group.opening)
  const [lines, setLines] = useState<OpeningBranchLine[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const startedRef = useRef(false)
  const games = explorerGames(group)
  const parentName = opening?.name ?? group.opening?.name ?? ''

  useEffect(() => () => abortRef.current?.abort(), [])

  function loadLines() {
    if (startedRef.current) return
    startedRef.current = true
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('loading')
    setError(null)
    void fetchOpeningBranch(fen, bandsFromKey(ratingKey), group.uci, controller.signal)
      .then((branch) => {
        if (controller.signal.aborted) return
        setOpening(branch.opening ?? group.opening)
        setLines(sortBranchLines(branch.lines))
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        startedRef.current = false
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Opening tree failed.')
      })
  }

  function onToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open) loadLines()
  }

  return (
    <details className="explore-disclosure" data-san={group.san} onToggle={onToggle}>
      <summary className="explore-summary">
        <span className="rating-band-move-row">
          <span className="explore-summary-main">
            <span className="explore-chevron" aria-hidden="true" />
            <span className="rating-band-san">{group.san}</span>
          </span>
          <span className="explore-pct">{shareLabel(games, total)}</span>
        </span>
        {group.averageRating > 0 ? (
          <p className="rating-band-games">
            <AverageRating value={group.averageRating} />
          </p>
        ) : null}
        <ResultBar white={group.white} draws={group.draws} black={group.black} />
      </summary>
      <div className="explore-branch">
        {parentName ? (
          <p className="explore-opening-name">
            {opening?.eco ? `${opening.eco} ` : ''}
            {parentName}
          </p>
        ) : null}
        {status === 'loading' ? (
          <p className="rating-band-note" role="status">
            Loading lines…
          </p>
        ) : null}
        {status === 'error' ? (
          <p className="rating-band-note is-error" role="alert">
            {error ?? 'Opening tree failed.'}
          </p>
        ) : null}
        {status === 'ready' && lines.length === 0 ? (
          <p className="rating-band-note">
            Lichess did not name a line under {group.san} for these bands.
          </p>
        ) : null}
        {lines.length > 0 ? (
          <ul className="explore-lines" aria-label={`Named lines under ${group.san}`}>
            {lines.map((line) => {
              const lineGames = explorerGames(line)
              const rate = sideWinRate(line)
              return (
                <li
                  key={line.name}
                  className="explore-line"
                  data-line={line.name}
                  data-mover={line.mover}
                  data-win-rate={rate < 0 ? '' : rate.toFixed(4)}
                >
                  <div className="rating-band-move-row">
                    <span className="explore-line-name">
                      {line.eco ? `${line.eco} ` : ''}
                      {lineLabel(line.name, parentName)}
                    </span>
                    <span className="explore-pct">{shareLabel(lineGames, total)}</span>
                  </div>
                  <ResultBar white={line.white} draws={line.draws} black={line.black} />
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </details>
  )
}

export const ExploreOpenings: FC<Props> = ({ fen }) => {
  const [ratings, setRatings] = useState<RatingBandId[]>([DEFAULT_RATING_BAND])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const selected = normalizeRatings(ratings)
  const ratingKey = selected.join(',')
  const requestKey = `${ratingKey}\n${fen}`
  const requestUrl = openingExplorerApiUrl(fen, selected, { moves: EXPLORER_MOVE_CAP })
  const current = snapshot && snapshot.key === requestKey ? snapshot : null
  const status = current?.status ?? 'loading'
  const groups = current?.status === 'ready' ? current.groups : null
  const total = current?.status === 'ready' ? current.total : 0
  const error = current?.status === 'error' ? current.error : null

  useEffect(() => {
    const controller = new AbortController()
    const key = requestKey
    const bands = bandsFromKey(ratingKey)
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
        Lichess combines the selected rating bands. First moves are listed from a
        through h. Open a move to see its named lines.
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
          <ul
            className="explore-groups"
            data-parent-order={groups.map((group) => group.san).join(',')}
          >
            {groups.map((group) => (
              <li key={`${requestKey}:${group.uci}`}>
                <OpeningDisclosure
                  group={group}
                  total={total}
                  fen={fen}
                  ratingKey={ratingKey}
                />
              </li>
            ))}
          </ul>
        </TooltipProvider>
      ) : null}
    </section>
  )
}
