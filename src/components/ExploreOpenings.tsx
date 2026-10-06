import { useEffect, useRef, useState, type FC, type SyntheticEvent } from 'react'
import { Chess } from 'chess.js'
import { RatingBandMultiSelect } from '@/components/RatingBandMultiSelect'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { START_FEN } from '@/lib/fenBridge'
import {
  DEFAULT_RATING_BAND,
  EXPLORER_MOVE_CAP,
  blackWinRate,
  explorerGames,
  fetchBlackDefenses,
  fetchLichessExplorer,
  fetchOpeningBranch,
  isOpeningVariation,
  isRatingBandId,
  normalizeRatings,
  openingExplorerApiUrl,
  sortBlackDefenses,
  sortBranchLines,
  sortByWinRate,
  whiteWinRate,
  type BlackDefense,
  type ExplorerOpening,
  type OpeningBranchLine,
  type RatingBandId,
} from '@/lib/lichessExplorer'

const DEBOUNCE_MS = 250
const WHITE_FIRST_MOVES = new Set(new Chess(START_FEN).moves())

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

/** Win rate for the section's side. Blank when the line has no games. */
function advantageLabel(wins: number, white: number, draws: number, black: number) {
  const games = white + draws + black
  if (games <= 0) return ''
  return `${((wins / games) * 100).toFixed(1)}%`
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
  ratings: RatingBandId[],
  signal: AbortSignal,
): Promise<{ total: number; groups: OpeningGroup[] }> {
  const root = await fetchLichessExplorer(START_FEN, ratings, signal, {
    moves: EXPLORER_MOVE_CAP,
  })
  const groups = sortByWinRate(
    root.moves
      .filter((move) => WHITE_FIRST_MOVES.has(move.san))
      .map((move) => ({
        san: move.san,
        uci: move.uci,
        white: move.white,
        draws: move.draws,
        black: move.black,
        averageRating: move.averageRating,
        opening: move.opening,
      })),
    'white',
    (move) => move.san,
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
  ratingKey,
}: {
  group: OpeningGroup
  ratingKey: string
}) {
  const [status, setStatus] = useState<BranchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<ExplorerOpening | null>(group.opening)
  const [lines, setLines] = useState<OpeningBranchLine[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const startedRef = useRef(false)
  const parentName = opening?.name ?? ''
  const showEmpty = status === 'ready' && lines.length === 0 && !parentName

  useEffect(() => () => abortRef.current?.abort(), [])

  function loadLines() {
    if (startedRef.current) return
    startedRef.current = true
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('loading')
    setError(null)
    void fetchOpeningBranch(
      START_FEN,
      bandsFromKey(ratingKey),
      group.uci,
      controller.signal,
    )
      .then((branch) => {
        if (controller.signal.aborted) return
        const nextOpening = branch.opening
        const parent = nextOpening?.name ?? ''
        setOpening(nextOpening)
        setLines(
          sortBranchLines(
            branch.lines.filter((line) => isOpeningVariation(parent, line.name)),
          ),
        )
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
          <span className="explore-pct">
            {advantageLabel(group.white, group.white, group.draws, group.black)}
          </span>
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
        {showEmpty ? (
          <p className="rating-band-note">
            Lichess did not name a line under {group.san} for these bands.
          </p>
        ) : null}
        {lines.length > 0 ? (
          <ul className="explore-lines" aria-label={`Named lines under ${group.san}`}>
            {lines.map((line) => {
              const rate = whiteWinRate(line)
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
                    <span className="explore-pct">
                      {advantageLabel(line.white, line.white, line.draws, line.black)}
                    </span>
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

function BlackDefenses({ ratingKey }: { ratingKey: string }) {
  const [status, setStatus] = useState<BranchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [defenses, setDefenses] = useState<BlackDefense[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const startedRef = useRef(false)

  useEffect(() => () => abortRef.current?.abort(), [])

  function loadDefenses() {
    if (startedRef.current) return
    startedRef.current = true
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('loading')
    setError(null)
    void fetchBlackDefenses(START_FEN, bandsFromKey(ratingKey), controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return
        setDefenses(sortBlackDefenses(list.defenses))
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        startedRef.current = false
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Opening defenses failed.')
      })
  }

  function onToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open) loadDefenses()
  }

  return (
    <details className="explore-side" data-side="black" onToggle={onToggle}>
      <summary className="explore-side-summary">
        <span className="explore-chevron" aria-hidden="true" />
        Black
      </summary>
      <div className="explore-side-body">
        {status === 'loading' ? (
          <p className="rating-band-note" role="status">
            Loading defenses…
          </p>
        ) : null}
        {status === 'error' ? (
          <p className="rating-band-note is-error" role="alert">
            {error ?? 'Opening defenses failed.'}
          </p>
        ) : null}
        {status === 'ready' && defenses.length === 0 ? (
          <p className="rating-band-note">
            Lichess did not name a defense for these bands.
          </p>
        ) : null}
        {defenses.length > 0 ? (
          <ul
            className="explore-lines"
            aria-label="Black defenses"
            data-defense-order={defenses.map((defense) => defense.san).join(',')}
          >
            {defenses.map((defense) => {
              const rate = blackWinRate(defense)
              return (
                <li
                  key={defense.name}
                  className="explore-line"
                  data-defense={defense.name}
                  data-san={defense.san}
                  data-win-rate={rate < 0 ? '' : rate.toFixed(4)}
                >
                  <div className="rating-band-move-row">
                    <span className="explore-defense-main">
                      <span className="rating-band-san">{defense.san}</span>
                      <span className="explore-line-name">
                        {defense.eco ? `${defense.eco} ` : ''}
                        {defense.name}
                      </span>
                    </span>
                    <span className="explore-pct">
                      {advantageLabel(
                        defense.black,
                        defense.white,
                        defense.draws,
                        defense.black,
                      )}
                    </span>
                  </div>
                  {defense.averageRating > 0 ? (
                    <p className="rating-band-games">
                      <AverageRating value={defense.averageRating} />
                    </p>
                  ) : null}
                  <ResultBar
                    white={defense.white}
                    draws={defense.draws}
                    black={defense.black}
                  />
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </details>
  )
}

export const ExploreOpenings: FC = () => {
  const [ratings, setRatings] = useState<RatingBandId[]>([DEFAULT_RATING_BAND])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const selected = normalizeRatings(ratings)
  const ratingKey = selected.join(',')
  const requestUrl = openingExplorerApiUrl(START_FEN, selected, {
    moves: EXPLORER_MOVE_CAP,
  })
  const current = snapshot && snapshot.key === ratingKey ? snapshot : null
  const status = current?.status ?? 'loading'
  const groups = current?.status === 'ready' ? current.groups : null
  const error = current?.status === 'error' ? current.error : null

  useEffect(() => {
    const controller = new AbortController()
    const key = ratingKey
    const bands = bandsFromKey(ratingKey)
    const timer = window.setTimeout(() => {
      void loadGroups(bands, controller.signal)
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
  }, [ratingKey])

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
        Lichess combines the selected rating bands. Each list is ordered by that
        side’s win rate.
      </p>

      <TooltipProvider delayDuration={250}>
        <div className="explore-sides">
          <details className="explore-side" data-side="white">
            <summary className="explore-side-summary">
              <span className="explore-chevron" aria-hidden="true" />
              White
            </summary>
            <div className="explore-side-body">
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
                  No rated games in these bands reached the starting position.
                </p>
              ) : null}
              {groups && groups.length > 0 ? (
                <ul
                  className="explore-groups"
                  data-parent-order={groups.map((group) => group.san).join(',')}
                >
                  {groups.map((group) => (
                    <li key={`${ratingKey}:${group.uci}`}>
                      <OpeningDisclosure group={group} ratingKey={ratingKey} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </details>
          <BlackDefenses key={ratingKey} ratingKey={ratingKey} />
        </div>
      </TooltipProvider>
    </section>
  )
}
