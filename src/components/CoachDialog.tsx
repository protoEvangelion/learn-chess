import { useEffect, useState, type FC } from 'react'
import type { BestMoveResult } from '@/lib/stockfishOpponent'
import { advantageFromBest } from '@/lib/advantage'
import { materialFromFen, materialGlyphs } from '@/lib/material'
import type { CoachTips } from '@/lib/coachTips'

type Props = {
  open: boolean
  onClose: () => void
  fen: string
  best: BestMoveResult | null
  analysisStatus: 'idle' | 'loading' | 'error'
  analysisError: string | null
  coachTips: CoachTips | null
  coachStatus: 'idle' | 'loading' | 'error'
  coachError: string | null
  tip3Open: boolean
  onTip3OpenChange: (open: boolean) => void
}

function TipRow({
  label,
  body,
  open,
  onOpenChange,
}: {
  label: string
  body: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <details
      className="coach-tip"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open
        if (next !== open) onOpenChange(next)
      }}
    >
      <summary>{label}</summary>
      <p className="coach-tip-body">{body}</p>
    </details>
  )
}

export const CoachDialog: FC<Props> = ({
  open,
  onClose,
  fen,
  best,
  analysisStatus,
  analysisError,
  coachTips,
  coachStatus,
  coachError,
  tip3Open,
  onTip3OpenChange,
}) => {
  const advantage = advantageFromBest(best)
  const material = materialFromFen(fen)
  const barWhitePercent = advantage?.whitePercent ?? 50
  const [tip1Open, setTip1Open] = useState(true)
  const [tip2Open, setTip2Open] = useState(false)

  useEffect(() => {
    if (!coachTips) return
    setTip1Open(true)
    setTip2Open(false)
  }, [coachTips])

  if (!open) return null

  return (
    <div className="coach-backdrop" onClick={onClose} role="presentation">
      <aside
        className="coach-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Coach"
      >
        <header className="coach-dialog-header">
          <h2>Coach</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>

        {analysisError && <p className="error">{analysisError}</p>}

        {coachTips && (
          <div className="coach-tips">
            <TipRow
              label="1 · Nudge"
              body={coachTips.tip1}
              open={tip1Open}
              onOpenChange={setTip1Open}
            />
            <TipRow
              label="2 · Closer look"
              body={coachTips.tip2}
              open={tip2Open}
              onOpenChange={setTip2Open}
            />
            <TipRow
              label="3 · Recommended move"
              body={coachTips.tip3}
              open={tip3Open}
              onOpenChange={onTip3OpenChange}
            />
          </div>
        )}

        {!coachTips && (
          <p className="meta">
            {coachStatus === 'loading'
              ? 'Writing tips…'
              : analysisStatus === 'loading'
                ? 'Looking up best move…'
                : coachError
                  ? null
                  : best
                    ? 'Preparing coach tips…'
                    : 'No best move for this position.'}
          </p>
        )}

        {coachError && <p className="error">{coachError}</p>}

        <div
          className="eval-bar-h"
          title={
            advantage
              ? `Engine: ${advantage.label} ${advantage.detail}`
              : 'Evaluating…'
          }
        >
          <div
            className="eval-bar-h-white"
            style={{ width: `${barWhitePercent}%` }}
          />
          <span className="eval-bar-h-label">
            {advantage
              ? advantage.label === 'Even'
                ? `Even ${advantage.detail}`
                : `${advantage.label} ${advantage.detail}`
              : analysisStatus === 'loading'
                ? '…'
                : '—'}
          </span>
        </div>

        <div className="material-row">
          <div className="material-side">
            <span className="material-name">White</span>
            <span className="material-pieces" aria-hidden="true">
              {materialGlyphs(material.whiteCaptures)}
            </span>
            {material.whiteScore > 0 && (
              <span className="material-score">+{material.whiteScore}</span>
            )}
          </div>
          <div className="material-side">
            <span className="material-name">Black</span>
            <span className="material-pieces" aria-hidden="true">
              {materialGlyphs(material.blackCaptures)}
            </span>
            {material.whiteScore < 0 && (
              <span className="material-score">
                +{Math.abs(material.whiteScore)}
              </span>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

/** Compact HUD control that opens the coach dialog. */
export const CoachIconButton: FC<{
  onClick: () => void
  active?: boolean
}> = ({ onClick, active }) => (
  <button
    type="button"
    className={`icon-btn${active ? ' active' : ''}`}
    onClick={onClick}
    aria-label="Open coach"
    title="Coach"
  >
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
      <path d="M8 7h8" />
      <path d="M8 11h6" />
      <path d="M8 15h4" />
    </svg>
  </button>
)
