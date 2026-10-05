import { useEffect, useState, type FC } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DEFAULT_RATING_BAND,
  RATING_BANDS,
  explorerGames,
  fetchLichessExplorer,
  isRatingBandId,
  lichessExplorerUrl,
  type ExplorerPosition,
  type RatingBandId,
} from '@/lib/lichessExplorer'

type Props = {
  fen: string
}

const DEBOUNCE_MS = 250

type Snapshot = {
  key: string
  status: 'ready' | 'error'
  error: string | null
  result: ExplorerPosition | null
}

function formatCount(value: number) {
  return value.toLocaleString('en-US')
}

function resultLabel(white: number, draws: number, black: number) {
  return `White ${formatCount(white)} · Draw ${formatCount(draws)} · Black ${formatCount(black)}`
}

export const RatingBandMoves: FC<Props> = ({ fen }) => {
  const [rating, setRating] = useState<RatingBandId>(DEFAULT_RATING_BAND)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const requestKey = `${rating}\n${fen}`
  const requestUrl = lichessExplorerUrl(fen, rating)
  const current =
    snapshot && snapshot.key === requestKey ? snapshot : null
  const status = current?.status ?? 'loading'
  const result = current?.status === 'ready' ? current.result : null
  const error = current?.status === 'error' ? current.error : null
  const bandLabel =
    RATING_BANDS.find((band) => band.id === rating)?.label ?? rating

  useEffect(() => {
    const controller = new AbortController()
    const key = requestKey
    const timer = window.setTimeout(() => {
      void fetchLichessExplorer(fen, rating, controller.signal)
        .then((position) => {
          if (controller.signal.aborted) return
          setSnapshot({
            key,
            status: 'ready',
            error: null,
            result: position,
          })
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          if (err instanceof DOMException && err.name === 'AbortError') return
          setSnapshot({
            key,
            status: 'error',
            error:
              err instanceof Error
                ? err.message
                : 'Lichess explorer failed.',
            result: null,
          })
        })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [fen, rating, requestKey])

  const totalGames = result ? explorerGames(result) : 0

  return (
    <section
      className="rating-band"
      aria-label="Games at this rating"
      aria-busy={status === 'loading'}
      data-explorer-url={requestUrl}
      data-rating={rating}
    >
      <div className="rating-band-head">
        <h3 className="rating-band-title" id="rating-band-heading">
          Games at this rating
        </h3>
        <Select
          value={rating}
          onValueChange={(value) => {
            if (isRatingBandId(value)) setRating(value)
          }}
        >
          <SelectTrigger
            id="rating-band"
            className="rating-band-select"
            size="sm"
            aria-label="Rating band"
            aria-describedby="rating-band-heading"
          >
            <SelectValue placeholder={bandLabel} />
          </SelectTrigger>
          <SelectContent
            position="popper"
            align="end"
            className="rating-band-select-content"
          >
            {RATING_BANDS.map((band) => (
              <SelectItem key={band.id} value={band.id}>
                {band.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="rating-band-note" id="rating-band-note">
        Popularity and results from Lichess blitz, rapid, and classical games
        in the {bandLabel} band. Each row is games played and the white, draw,
        and black results.
      </p>

      {status === 'loading' ? (
        <p className="rating-band-note" role="status">
          Loading games at this rating…
        </p>
      ) : null}

      {status === 'error' ? (
        <p className="rating-band-note is-error" role="alert">
          {error ?? 'Lichess explorer failed.'}
        </p>
      ) : null}

      {result && result.queued ? (
        <p className="rating-band-note" role="status">
          Lichess is still gathering this position.
        </p>
      ) : null}

      {result && !result.queued && result.moves.length === 0 ? (
        <p className="rating-band-note" role="status">
          No rated games in the {bandLabel} band reached this position.
        </p>
      ) : null}

      {result && result.moves.length > 0 ? (
        <>
          <p className="rating-band-total">
            {formatCount(totalGames)} games in this band
          </p>
          <ul className="rating-band-list">
            {result.moves.map((move) => {
              const games = explorerGames(move)
              const results = resultLabel(move.white, move.draws, move.black)
              return (
                <li key={`${move.uci}:${move.san}`} className="rating-band-move">
                  <div className="rating-band-move-row">
                    <span className="rating-band-san">{move.san}</span>
                    <span className="rating-band-games">
                      {formatCount(games)} game{games === 1 ? '' : 's'}
                      {move.averageRating > 0
                        ? ` · avg ${formatCount(move.averageRating)}`
                        : ''}
                    </span>
                  </div>
                  <p className="rating-band-results">{results}</p>
                  {games > 0 ? (
                    <div
                      className="rating-band-bar"
                      aria-hidden="true"
                    >
                      <span
                        className="rating-band-bar-white"
                        style={{ flexGrow: move.white }}
                      />
                      <span
                        className="rating-band-bar-draw"
                        style={{ flexGrow: move.draws }}
                      />
                      <span
                        className="rating-band-bar-black"
                        style={{ flexGrow: move.black }}
                      />
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </section>
  )
}
