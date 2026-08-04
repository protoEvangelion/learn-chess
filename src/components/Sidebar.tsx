import { useEffect, useState } from 'react'
import type { Color } from '@logic/pieces'
import {
  STRENGTH_LEVELS,
  type BestMoveResult,
  type StrengthLevel,
} from '@/lib/stockfishOpponent'
import { advantageFromBest } from '@/lib/advantage'
import { materialFromFen, materialGlyphs } from '@/lib/material'
import type { CoachTips } from '@/lib/coachTips'

type Props = {
  fen: string
  turn: Color
  playerColor: Color
  strength: StrengthLevel
  best: BestMoveResult | null
  analysisStatus: 'idle' | 'loading' | 'error'
  analysisError: string | null
  coachTips: CoachTips | null
  coachStatus: 'idle' | 'loading' | 'error'
  coachError: string | null
  tip3Open: boolean
  opponentThinking: boolean
  gameOverLabel: string | null
  canUndo: boolean
  onStrengthChange: (level: StrengthLevel) => void
  onColorChange: (color: Color) => void
  onAskCoach: () => void
  onTip3OpenChange: (open: boolean) => void
  onUndo: () => void
  onNewGame: () => void
  onFenChange: (fen: string) => void
  onFenCommit: () => void
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

export function Sidebar({
  fen,
  turn,
  playerColor,
  strength,
  best,
  analysisStatus,
  analysisError,
  coachTips,
  coachStatus,
  coachError,
  tip3Open,
  opponentThinking,
  gameOverLabel,
  canUndo,
  onStrengthChange,
  onColorChange,
  onAskCoach,
  onTip3OpenChange,
  onUndo,
  onNewGame,
  onFenChange,
  onFenCommit,
}: Props) {
  const levelCfg = STRENGTH_LEVELS[strength]
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

  return (
    <aside className="sidebar">
      <div className="card">
        <label className="slider-label" htmlFor="strength">
          Opponent strength — level <strong>{strength}</strong>
          <span className="elo-hint">({levelCfg.eloHint} Elo)</span>
        </label>
        <input
          id="strength"
          className="slider"
          type="range"
          min={1}
          max={8}
          step={1}
          value={strength}
          onChange={(e) =>
            onStrengthChange(Number(e.target.value) as StrengthLevel)
          }
        />
        <div className="slider-ends">
          <span>1 weak</span>
          <span>8 strong</span>
        </div>

        <div className="btn-row">
          <button
            type="button"
            className={playerColor === 'white' ? '' : 'ghost'}
            onClick={() => onColorChange('white')}
          >
            Play White
          </button>
          <button
            type="button"
            className={playerColor === 'black' ? '' : 'ghost'}
            onClick={() => onColorChange('black')}
          >
            Play Black
          </button>
        </div>

        <p className="meta">
          {gameOverLabel ? (
            <strong>{gameOverLabel}</strong>
          ) : opponentThinking ? (
            <>Opponent thinking (level {strength})…</>
          ) : turn === playerColor ? (
            <>Your turn ({turn})</>
          ) : (
            <>Opponent to move ({turn})</>
          )}
        </p>
      </div>

      <div className="card coach-card">
        <div className="coach-card-head">
          <h2>Coach</h2>
        </div>

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

        {!coachTips && coachStatus !== 'loading' && (
          <p className="meta">
            {analysisStatus === 'loading'
              ? 'Looking up best move…'
              : best
                ? 'Ask the coach for progressive tips.'
                : 'No best move for this position.'}
          </p>
        )}

        {coachError && <p className="error">{coachError}</p>}

        <div className="btn-row">
          <button
            type="button"
            onClick={onAskCoach}
            disabled={!best || coachStatus === 'loading'}
          >
            {coachStatus === 'loading' ? 'Asking coach…' : 'Ask coach'}
          </button>
        </div>

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
            {material.whiteScore < 0 && (
              <span className="material-score">
                +{Math.abs(material.whiteScore)}
              </span>
            )}
            <span className="material-pieces" aria-hidden="true">
              {materialGlyphs(material.blackCaptures)}
            </span>
            <span className="material-name">Black</span>
          </div>
        </div>

        <label className="coach-label" htmlFor="fen-input">
          Position (FEN)
        </label>
        <textarea
          id="fen-input"
          value={fen}
          onChange={(e) => onFenChange(e.target.value)}
          onBlur={onFenCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onFenCommit()
            }
          }}
          rows={3}
          spellCheck={false}
        />

        <div className="btn-row coach-actions">
          <button type="button" className="ghost" onClick={onNewGame}>
            New game
          </button>
          <button
            type="button"
            className="ghost"
            onClick={onUndo}
            disabled={!canUndo || opponentThinking}
          >
            Undo
          </button>
        </div>
      </div>
    </aside>
  )
}
