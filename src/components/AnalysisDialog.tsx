import { useEffect, useMemo, useRef, useState, type FC } from 'react'
import { PixelButton } from '@/components/ui/PixelButton'
import { PanelResizeHandle } from '@/components/PanelResizeHandle'
import {
  REPORT_TAG_ORDER,
  TAG_LABEL,
  type AnalysisReport,
  type MoveQualityTag,
  type ReviewPly,
} from '@/lib/gameReview'

type TabId = 'import' | 'report' | 'analysis'

type Props = {
  open: boolean
  onClose: () => void
  report: AnalysisReport | null
  scrubIndex: number
  onScrubTo: (index: number) => void
  analyzing?: boolean
  analyzeProgress?: string | null
  analyzeError?: string | null
  onAskCoachRecap?: () => void
  coachRecapBusy?: boolean
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
  onAskCoachRecap,
  coachRecapBusy = false,
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
}) => {
  const [tab, setTab] = useState<TabId>(() => (report ? 'report' : 'import'))
  const [playing, setPlaying] = useState(false)
  const onScrubToRef = useRef(onScrubTo)
  onScrubToRef.current = onScrubTo
  const moveRows = useMemo(
    () => (report ? groupMoves(report.plies) : []),
    [report],
  )
  const maxPly = report?.plies.length ?? 0
  const whiteLabel = report?.whiteName ?? 'White'
  const blackLabel = report?.blackName ?? 'Black'

  useEffect(() => {
    if (!open) return
    setTab(report ? 'report' : 'import')
  }, [open, report])

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
        aria-label="Game analysis"
        inert={!open ? true : undefined}
      >
        <PanelResizeHandle
          width={panelWidth}
          onWidthChange={onPanelWidthChange}
          onResizeEnd={onPanelResizeEnd}
        />
        <header className="analysis-dialog-header">
          <div className="analysis-dialog-title">
            <p className="analysis-eyebrow">Review</p>
            <h2>Game Analysis</h2>
          </div>
          <PixelButton ghost onClick={onClose}>
            Close
          </PixelButton>
        </header>

        <div className="analysis-tabs is-three" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'import'}
            className={tab === 'import' ? 'is-active' : ''}
            onClick={() => setTab('import')}
          >
            Import
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'report'}
            className={tab === 'report' ? 'is-active' : ''}
            onClick={() => setTab('report')}
          >
            Report
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'analysis'}
            className={tab === 'analysis' ? 'is-active' : ''}
            onClick={() => setTab('analysis')}
          >
            Analysis
          </button>
        </div>

        <div className="analysis-dialog-body">
          {tab === 'import' && (
            <div className="analysis-import">
              <p className="analysis-import-lead">
                Paste a finished game as PGN or a chess.com live/daily link, then
                run a coach review on the board.
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
                className="settings-full-btn"
                onClick={onImportGame}
                disabled={importBusy || analyzing || !importDraft.trim()}
              >
                {importBusy ? 'Importing…' : 'Import & review'}
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
          )}

          {analyzing && tab !== 'import' && (
            <p className="analysis-status">{analyzeProgress ?? 'Analyzing…'}</p>
          )}

          {!analyzing && analyzeError && tab !== 'import' && (
            <p className="analysis-status is-error">{analyzeError}</p>
          )}

          {!analyzing && !report && !analyzeError && tab !== 'import' && (
            <p className="analysis-status">
              Import a game or finish a match, then run review to see the report.
            </p>
          )}

          {report && tab === 'report' && (
            <div className="analysis-report">
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

              <section className="analysis-counts">
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

              {onAskCoachRecap && (
                <PixelButton
                  className="settings-full-btn"
                  onClick={onAskCoachRecap}
                  disabled={coachRecapBusy || analyzing}
                >
                  {coachRecapBusy ? 'Writing recap…' : 'Ask coach for recap'}
                </PixelButton>
              )}
            </div>
          )}

          {report && tab === 'analysis' && (
            <div className="analysis-moves">
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
          )}
        </div>

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
