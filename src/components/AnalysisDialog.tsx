import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FC,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { PixelButton } from '@/components/ui/PixelButton'
import { PanelResizeHandle } from '@/components/PanelResizeHandle'
import {
  CoachPane,
  type CoachChatMessage,
} from '@/components/CoachPane'
import {
  REPORT_TAG_ORDER,
  TAG_LABEL,
  type AnalysisReport,
  type MoveQualityTag,
  type ReviewPly,
} from '@/lib/gameReview'
import { arrowsForReplies, type FrequencyArrow } from '@/lib/replyArrows'
import { ExploreOpenings } from '@/components/ExploreOpenings'

type TabId = 'explore' | 'games'

type Props = {
  open: boolean
  onClose: () => void
  report: AnalysisReport | null
  scrubIndex: number
  onScrubTo: (index: number) => void
  analyzing?: boolean
  analyzeProgress?: string | null
  analyzeError?: string | null
  coachExplanation?: string | null
  coachStatus?: 'idle' | 'loading' | 'error'
  coachError?: string | null
  coachChat?: CoachChatMessage[]
  coachChatStatus?: 'idle' | 'loading' | 'error'
  coachChatError?: string | null
  onSendCoachChat?: (question: string) => void
  chessComUsername: string
  onChessComUsernameChange: (username: string) => void
  importDraft: string
  onImportDraftChange: (value: string) => void
  onImportGame: () => void
  importBusy?: boolean
  importError?: string | null
  importStatus?: string | null
  onReviewCurrent?: () => void
  canReviewCurrent?: boolean
  panelWidth: number
  onPanelWidthChange: (width: number) => void
  onPanelResizeEnd?: (width: number) => void
  onFrequencyArrows?: (arrows: FrequencyArrow[]) => void
  /** Current board position. Explorer stats follow this, not the URL. */
  fen: string
}

const DEFAULT_REVIEW_COACH_FRACTION = 0.42
const EXPANDED_REVIEW_COACH_FRACTION = 2 / 3
const MIN_REVIEW_COACH_FRACTION = 0.28
const MAX_REVIEW_COACH_FRACTION = 0.8

function clampReviewCoachFraction(fraction: number) {
  return Math.min(
    MAX_REVIEW_COACH_FRACTION,
    Math.max(MIN_REVIEW_COACH_FRACTION, fraction),
  )
}

function ReviewCoachResizeHandle({
  fraction,
  containerRef,
  onFractionChange,
}: {
  fraction: number
  containerRef: React.RefObject<HTMLDivElement | null>
  onFractionChange: (fraction: number) => void
}) {
  const dragging = useRef(false)
  const startY = useRef(0)
  const startFraction = useRef(fraction)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true
    startY.current = event.clientY
    startFraction.current = fraction
    document.body.classList.add('is-review-coach-resizing')
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    event.preventDefault()
    const height = containerRef.current?.getBoundingClientRect().height ?? 0
    if (height <= 0) return
    const delta = startY.current - event.clientY
    onFractionChange(
      clampReviewCoachFraction(startFraction.current + delta / height),
    )
  }

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    document.body.classList.remove('is-review-coach-resizing')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const delta = event.key === 'ArrowUp' ? 0.05 : -0.05
    onFractionChange(clampReviewCoachFraction(fraction + delta))
  }

  return (
    <div
      className="analysis-coach-resize-handle"
      role="separator"
      tabIndex={0}
      aria-label="Resize coach area"
      aria-orientation="horizontal"
      aria-valuemin={Math.round(MIN_REVIEW_COACH_FRACTION * 100)}
      aria-valuemax={Math.round(MAX_REVIEW_COACH_FRACTION * 100)}
      aria-valuenow={Math.round(fraction * 100)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
      onKeyDown={onKeyDown}
    />
  )
}

function TagGlyph({ tag }: { tag: MoveQualityTag }) {
  const symbol =
    tag === 'best'
      ? '★'
      : tag === 'excellent'
        ? '+'
        : tag === 'okay'
          ? '✓'
          : tag === 'inaccuracy'
            ? '?!'
            : tag === 'mistake'
              ? '?'
              : tag === 'blunder'
                ? '??'
                : 'T'
  return (
    <span className={`analysis-tag is-${tag}`} title={TAG_LABEL[tag]}>
      {symbol}
    </span>
  )
}

function EvalGraph({
  series,
  scrubIndex,
  onScrubTo,
}: {
  series: Array<{ ply: number; pawns: number }>
  scrubIndex: number
  onScrubTo: (index: number) => void
}) {
  const w = 320
  const h = 96
  const pad = 6
  if (series.length === 0) {
    return <div className="analysis-graph is-empty">No eval data yet</div>
  }

  const pts = series.map((s, i) => {
    const x =
      pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2)
    const y = pad + ((5 - s.pawns) / 10) * (h - pad * 2)
    return { x, y, ply: s.ply }
  })
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const midY = pad + ((5 - 0) / 10) * (h - pad * 2)
  const active = pts.find((p) => p.ply === scrubIndex) ?? null

  return (
    <svg
      className="analysis-graph"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="Evaluation graph"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = ((e.clientX - rect.left) / rect.width) * w
        let best = pts[0]
        let bestDist = Infinity
        for (const p of pts) {
          const dist = Math.abs(p.x - x)
          if (dist < bestDist) {
            bestDist = dist
            best = p
          }
        }
        onScrubTo(best.ply)
      }}
    >
      <line
        x1={pad}
        x2={w - pad}
        y1={midY}
        y2={midY}
        className="analysis-graph-zero"
      />
      <path d={d} className="analysis-graph-line" fill="none" />
      {pts.map((p) => (
        <circle
          key={p.ply}
          cx={p.x}
          cy={p.y}
          r={p.ply === scrubIndex ? 3.5 : 2}
          className={
            p.ply === scrubIndex
              ? 'analysis-graph-dot is-active'
              : 'analysis-graph-dot'
          }
        />
      ))}
      {active && (
        <line
          x1={active.x}
          x2={active.x}
          y1={pad}
          y2={h - pad}
          className="analysis-graph-cursor"
        />
      )}
    </svg>
  )
}

function groupMoves(plies: ReviewPly[]) {
  const rows: Array<{
    moveNo: number
    white?: ReviewPly
    black?: ReviewPly
  }> = []
  for (const ply of plies) {
    const moveNo = Math.ceil(ply.ply / 2)
    let row = rows.find((r) => r.moveNo === moveNo)
    if (!row) {
      row = { moveNo }
      rows.push(row)
    }
    if (ply.color === 'white') row.white = ply
    else row.black = ply
  }
  return rows
}

export const AnalysisDialog: FC<Props> = ({
  open,
  onClose,
  report,
  scrubIndex,
  onScrubTo,
  analyzing = false,
  analyzeProgress = null,
  analyzeError = null,
  coachExplanation = null,
  coachStatus = 'idle',
  coachError = null,
  coachChat = [],
  coachChatStatus = 'idle',
  coachChatError = null,
  onSendCoachChat,
  chessComUsername,
  onChessComUsernameChange,
  importDraft,
  onImportDraftChange,
  onImportGame,
  importBusy = false,
  importError = null,
  importStatus = null,
  onReviewCurrent,
  canReviewCurrent = false,
  panelWidth,
  onPanelWidthChange,
  onPanelResizeEnd,
  onFrequencyArrows,
  fen,
}) => {
  const [tab, setTab] = useState<TabId>(() => (report ? 'games' : 'explore'))
  const [importOpen, setImportOpen] = useState(false)
  const importWasBusy = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [reviewCoachFraction, setReviewCoachFraction] = useState(
    DEFAULT_REVIEW_COACH_FRACTION,
  )
  const reviewReportRef = useRef<HTMLDivElement>(null)
  const previousCoachQuestionCount = useRef(0)
  const onScrubToRef = useRef(onScrubTo)
  onScrubToRef.current = onScrubTo
  const moveRows = useMemo(
    () => (report ? groupMoves(report.plies) : []),
    [report],
  )
  const maxPly = report?.plies.length ?? 0
  const whiteLabel = report?.whiteName ?? 'White'
  const blackLabel = report?.blackName ?? 'Black'
  const replyPrefix = useMemo(
    () => (report ? report.plies.slice(0, scrubIndex).map((p) => p.san) : []),
    [report, scrubIndex],
  )
  const replyPrefixKey = replyPrefix.join('\n')
  const playedNext =
    report && scrubIndex < report.plies.length
      ? report.plies[scrubIndex].san
      : null
  const [replies, setReplies] = useState<{
    prefixKey: string
    scanned: number
    reached: number
    moves: Array<{
      san: string
      count: number
      wins: number
      draws: number
      losses: number
    }>
  } | null>(null)
  const [repliesStatus, setRepliesStatus] = useState<
    'idle' | 'loading' | 'error'
  >('idle')
  const [repliesError, setRepliesError] = useState<string | null>(null)
  const onFrequencyArrowsRef = useRef(onFrequencyArrows)
  onFrequencyArrowsRef.current = onFrequencyArrows
  const coachQuestionCount = useMemo(
    () => coachChat.filter((message) => message.role === 'user').length,
    [coachChat],
  )

  useEffect(() => {
    if (coachQuestionCount === 0) {
      previousCoachQuestionCount.current = 0
      setReviewCoachFraction(DEFAULT_REVIEW_COACH_FRACTION)
      return
    }
    if (previousCoachQuestionCount.current === 0) {
      setReviewCoachFraction(EXPANDED_REVIEW_COACH_FRACTION)
    }
    previousCoachQuestionCount.current = coachQuestionCount
  }, [coachQuestionCount])

  useEffect(() => {
    if (!open) return
    setTab(report ? 'games' : 'explore')
  }, [open, report])

  useEffect(() => {
    if (importWasBusy.current && !importBusy && !importError) {
      setImportOpen(false)
    }
    importWasBusy.current = Boolean(importBusy)
  }, [importBusy, importError])

  useEffect(() => {
    if (!open || !playing || !report) return
    if (scrubIndex >= maxPly) {
      setPlaying(false)
      return
    }
    const id = window.setTimeout(() => {
      onScrubToRef.current(Math.min(maxPly, scrubIndex + 1))
    }, 650)
    return () => window.clearTimeout(id)
  }, [open, playing, report, scrubIndex, maxPly])

  useEffect(() => {
    if (!open) setPlaying(false)
  }, [open])

  useEffect(() => {
    if (!open || tab !== 'games' || !report) {
      onFrequencyArrowsRef.current?.([])
      return
    }
    const username = chessComUsername.trim()
    if (!username) {
      setReplies(null)
      setRepliesStatus('idle')
      setRepliesError(null)
      onFrequencyArrowsRef.current?.([])
      return
    }
    const controller = new AbortController()
    const prefixKey = replyPrefixKey
    setReplies(null)
    setRepliesStatus('loading')
    setRepliesError(null)
    const timer = window.setTimeout(() => {
      void fetch('/api/opening-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ username, moves: replyPrefix }),
      })
        .then(async (res) => {
          const data = (await res.json()) as {
            error?: string
            scanned?: number
            reached?: number
            moves?: Array<{
              san: string
              count: number
              wins: number
              draws: number
              losses: number
            }>
          }
          if (controller.signal.aborted) return
          if (!res.ok) throw new Error(data.error || `Replies failed (${res.status})`)
          const moves = data.moves ?? []
          setReplies({
            prefixKey,
            scanned: data.scanned ?? 0,
            reached: data.reached ?? 0,
            moves,
          })
          setRepliesStatus('idle')
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setRepliesStatus('error')
          setRepliesError(err instanceof Error ? err.message : 'Replies failed')
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, tab, report, chessComUsername, replyPrefix, replyPrefixKey])

  useEffect(() => {
    if (
      !open ||
      tab !== 'games' ||
      !replies ||
      replies.prefixKey !== replyPrefixKey
    ) {
      onFrequencyArrowsRef.current?.([])
      return
    }
    onFrequencyArrowsRef.current?.(arrowsForReplies(replyPrefix, replies.moves))
  }, [open, tab, replies, replyPrefix, replyPrefixKey])

  return (
    <div
      className={['analysis-backdrop', open ? '' : 'is-closed']
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      aria-hidden={!open}
    >
      <aside
        className="analysis-dialog"
        role="dialog"
        aria-label="Analysis"
        inert={!open ? true : undefined}
      >
        <PanelResizeHandle
          width={panelWidth}
          onWidthChange={onPanelWidthChange}
          onResizeEnd={onPanelResizeEnd}
        />
        <header className="analysis-dialog-header">
          <div className="analysis-dialog-title">
            <h2>Analysis</h2>
          </div>
          <PixelButton ghost onClick={onClose}>
            Close
          </PixelButton>
        </header>

        <div className="analysis-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'explore'}
            className={tab === 'explore' ? 'is-active' : ''}
            onClick={() => setTab('explore')}
          >
            Explore
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'games'}
            className={tab === 'games' ? 'is-active' : ''}
            onClick={() => setTab('games')}
          >
            My Games
          </button>
        </div>

        <div className="analysis-dialog-body">
          {tab === 'explore' && open ? <ExploreOpenings fen={fen} /> : null}

          {tab === 'games' ? (
            <div className="my-games-toolbar">
              <PixelButton onClick={() => setImportOpen(true)}>
                Import
              </PixelButton>
            </div>
          ) : null}

          {analyzing && tab === 'games' && (
            <p className="analysis-status">{analyzeProgress ?? 'Analyzing…'}</p>
          )}

          {!analyzing && analyzeError && tab === 'games' && (
            <p className="analysis-status is-error">{analyzeError}</p>
          )}

          {!analyzing && !report && !analyzeError && tab === 'games' && (
            <p className="analysis-status">
              Import a game or finish a match, then run review to see My Games.
            </p>
          )}

          {report && tab === 'games' && (
            <div
              className="analysis-report"
              ref={reviewReportRef}
              style={
                {
                  '--review-coach-fraction': reviewCoachFraction,
                } as CSSProperties
              }
            >
              <div className="analysis-report-scroll">
                <EvalGraph
                  series={report.summary.evalSeries}
                  scrubIndex={scrubIndex}
                  onScrubTo={onScrubTo}
                />

                <section className="analysis-accuracies">
                  <h3>Accuracies</h3>
                  <div className="analysis-accuracy-row">
                    <div className="analysis-accuracy is-white">
                      <span className="analysis-accuracy-name">{whiteLabel}</span>
                      <strong>
                        {report.summary.whiteAccuracy != null
                          ? `${report.summary.whiteAccuracy}%`
                          : 'N/A'}
                      </strong>
                    </div>
                    <div className="analysis-accuracy is-black">
                      <span className="analysis-accuracy-name">{blackLabel}</span>
                      <strong>
                        {report.summary.blackAccuracy != null
                          ? `${report.summary.blackAccuracy}%`
                          : 'N/A'}
                      </strong>
                    </div>
                  </div>
                </section>

                <section className="analysis-counts" aria-label="My Games">
                  <h3>My Games</h3>
                  <div className="analysis-counts-head">
                    <span />
                    <span title={whiteLabel}>{whiteLabel}</span>
                    <span title={blackLabel}>{blackLabel}</span>
                  </div>
                  {REPORT_TAG_ORDER.map((tag) => (
                    <div key={tag} className="analysis-counts-row">
                      <span className="analysis-counts-label">
                        <TagGlyph tag={tag} />
                        {TAG_LABEL[tag]}
                      </span>
                      <span>{report.summary.whiteCounts[tag]}</span>
                      <span>{report.summary.blackCounts[tag]}</span>
                    </div>
                  ))}
                </section>

                <section className="analysis-replies" aria-label="Common replies">
                  <p className="analysis-replies-label">Common next moves</p>
                  {!chessComUsername.trim() && (
                    <p className="analysis-replies-note">
                      Use Import to add your chess.com username and see what people played against you from here.
                    </p>
                  )}
                  {chessComUsername.trim() && repliesStatus === 'loading' && !replies && (
                    <p className="analysis-replies-note">Reading your recent games…</p>
                  )}
                  {repliesError && (
                    <p className="analysis-replies-note is-error">{repliesError}</p>
                  )}
                  {replies && replies.moves.length === 0 && repliesStatus !== 'loading' && (
                    <p className="analysis-replies-note">
                      None of your last {replies.scanned} games reached this position.
                    </p>
                  )}
                  {replies && replies.moves.length > 0 && (
                    <ul className="analysis-reply-list">
                      {replies.moves.map((move) => {
                        const pct = replies.reached
                          ? Math.round((100 * move.count) / replies.reached)
                          : 0
                        const scored = move.wins + move.draws + move.losses
                        const score =
                          scored > 0
                            ? Math.round((100 * (move.wins + move.draws * 0.5)) / scored)
                            : null
                        return (
                          <li
                            key={move.san}
                            className={[
                              'analysis-reply',
                              playedNext === move.san ? 'is-played' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            <span className="analysis-reply-san">{move.san}</span>
                            <span className="analysis-reply-pct">{pct}%</span>
                            <span className="analysis-reply-meta">
                              {move.count} game{move.count === 1 ? '' : 's'}
                              {score != null ? ` · you ${score}%` : ''}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>

                <ul className="analysis-move-list">
                  {moveRows.map((row) => (
                    <li key={row.moveNo} className="analysis-move-row">
                      <span className="analysis-move-no">{row.moveNo}.</span>
                      {row.white ? (
                        <button
                          type="button"
                          className={[
                            'analysis-move-san',
                            scrubIndex === row.white.ply ? 'is-active' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => onScrubTo(row.white!.ply)}
                        >
                          {row.white.tag && <TagGlyph tag={row.white.tag} />}
                          {row.white.san}
                        </button>
                      ) : (
                        <span className="analysis-move-san is-empty">…</span>
                      )}
                      {row.black ? (
                        <button
                          type="button"
                          className={[
                            'analysis-move-san',
                            scrubIndex === row.black.ply ? 'is-active' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => onScrubTo(row.black!.ply)}
                        >
                          {row.black.tag && <TagGlyph tag={row.black.tag} />}
                          {row.black.san}
                        </button>
                      ) : (
                        <span className="analysis-move-san is-empty" />
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {onSendCoachChat && (
                <>
                  <ReviewCoachResizeHandle
                    fraction={reviewCoachFraction}
                    containerRef={reviewReportRef}
                    onFractionChange={setReviewCoachFraction}
                  />
                  <div className="analysis-coach-embed">
                    <CoachPane
                      explanation={coachExplanation}
                      coachStatus={coachStatus}
                      coachError={coachError}
                      chatMessages={coachChat}
                      chatStatus={coachChatStatus}
                      chatError={coachChatError}
                      onSendChat={onSendCoachChat}
                      isPlayerTurn
                      reviewMode
                      emptyHint=""
                    />
                  </div>
                </>
              )}
            </div>
          )}

        </div>

        {importOpen ? (
          <div className="import-modal-backdrop" role="presentation">
            <div
              className="import-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="import-modal-title"
            >
              <div className="import-modal-head">
                <h3 id="import-modal-title">Import</h3>
                <PixelButton ghost onClick={() => setImportOpen(false)}>
                  Close
                </PixelButton>
              </div>
              <p className="analysis-import-lead">
                Enter your chess.com username to review your latest game, or paste a PGN or game link.
              </p>
              <label className="slider-label" htmlFor="analysis-chesscom-user">
                Your chess.com username
                <span className="elo-hint">(sets which side is “you”)</span>
              </label>
              <input
                id="analysis-chesscom-user"
                className="settings-select"
                type="text"
                value={chessComUsername}
                placeholder="optional"
                autoComplete="username"
                onChange={(e) => onChessComUsernameChange(e.target.value)}
                disabled={importBusy || analyzing}
              />
              <label className="slider-label" htmlFor="analysis-import-pgn">
                PGN or chess.com game link
              </label>
              <textarea
                id="analysis-import-pgn"
                className="settings-fen import-textarea"
                value={importDraft}
                onChange={(e) => onImportDraftChange(e.target.value)}
                rows={8}
                spellCheck={false}
                placeholder={
                  'https://www.chess.com/game/live/…\nor\n[Event "…"]\n1. e4 e5 …'
                }
                disabled={importBusy || analyzing}
              />
              {importStatus && (
                <p className="settings-import-status">{importStatus}</p>
              )}
              {importError && <p className="error">{importError}</p>}
              <PixelButton
                className={
                  importBusy ? 'settings-full-btn is-busy' : 'settings-full-btn'
                }
                onClick={onImportGame}
                aria-busy={importBusy}
                disabled={
                  importBusy ||
                  analyzing ||
                  (!importDraft.trim() && !chessComUsername.trim())
                }
              >
                {importBusy ? (
                  <>
                    <span className="import-spinner" aria-hidden />
                    {analyzing ? 'Analyzing…' : 'Importing…'}
                  </>
                ) : importDraft.trim() ? (
                  'Import & review'
                ) : (
                  'Review latest game'
                )}
              </PixelButton>
              {onReviewCurrent && (
                <PixelButton
                  ghost
                  className="settings-full-btn"
                  onClick={onReviewCurrent}
                  disabled={!canReviewCurrent || importBusy || analyzing}
                >
                  {analyzing ? 'Analyzing…' : 'Review current game'}
                </PixelButton>
              )}
            </div>
          </div>
        ) : null}

        <footer className="analysis-transport">
          <PixelButton
            ghost
            disabled={!report || scrubIndex <= 0}
            onClick={() => {
              setPlaying(false)
              onScrubTo(0)
            }}
            aria-label="Start"
          >
            |&lt;
          </PixelButton>
          <PixelButton
            ghost
            disabled={!report || scrubIndex <= 0}
            onClick={() => {
              setPlaying(false)
              onScrubTo(scrubIndex - 1)
            }}
            aria-label="Previous"
          >
            &lt;
          </PixelButton>
          <PixelButton
            ghost
            disabled={!report || maxPly === 0}
            onClick={() => {
              if (scrubIndex >= maxPly) onScrubTo(0)
              setPlaying((p) => !p)
            }}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? '||' : '>'}
          </PixelButton>
          <span className="analysis-transport-label">
            {scrubIndex}/{maxPly}
          </span>
          <PixelButton
            ghost
            disabled={!report || scrubIndex >= maxPly}
            onClick={() => {
              setPlaying(false)
              onScrubTo(scrubIndex + 1)
            }}
            aria-label="Next"
          >
            &gt;
          </PixelButton>
          <PixelButton
            ghost
            disabled={!report || scrubIndex >= maxPly}
            onClick={() => {
              setPlaying(false)
              onScrubTo(maxPly)
            }}
            aria-label="End"
          >
            &gt;|
          </PixelButton>
        </footer>
      </aside>
    </div>
  )
}
