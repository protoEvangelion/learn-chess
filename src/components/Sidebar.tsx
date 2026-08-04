import type { Color } from '@logic/pieces'
import {
  STRENGTH_LEVELS,
  type BestMoveResult,
  type StrengthLevel,
} from '@/lib/stockfishOpponent'
import { advantageFromBest } from '@/lib/advantage'
import { materialFromFen, materialGlyphs } from '@/lib/material'

type Props = {
  fen: string
  turn: Color
  playerColor: Color
  strength: StrengthLevel
  coachEnabled: boolean
  best: BestMoveResult | null
  analysisStatus: 'idle' | 'loading' | 'error'
  analysisError: string | null
  coachNote: string
  coachStatus: 'idle' | 'loading' | 'error'
  coachError: string | null
  opponentThinking: boolean
  gameOverLabel: string | null
  canUndo: boolean
  onStrengthChange: (level: StrengthLevel) => void
  onColorChange: (color: Color) => void
  onCoachToggle: (enabled: boolean) => void
  onAskCoach: () => void
  onUndo: () => void
  onNewGame: () => void
  onFenChange: (fen: string) => void
}

export function Sidebar({
  fen,
  turn,
  playerColor,
  strength,
  coachEnabled,
  best,
  analysisStatus,
  analysisError,
  coachNote,
  coachStatus,
  coachError,
  opponentThinking,
  gameOverLabel,
  canUndo,
  onStrengthChange,
  onColorChange,
  onCoachToggle,
  onAskCoach,
  onUndo,
  onNewGame,
  onFenChange,
}: Props) {
  const levelCfg = STRENGTH_LEVELS[strength]
  const advantage = coachEnabled ? advantageFromBest(best) : null
  const material = materialFromFen(fen)
  const barWhitePercent = advantage?.whitePercent ?? 50

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
          <label className="coach-toggle">
            <input
              type="checkbox"
              checked={coachEnabled}
              onChange={(e) => onCoachToggle(e.target.checked)}
            />
            Show tips
          </label>
        </div>

        <div
          className={`coach-recommendation${coachEnabled ? ' is-revealed' : ''}`}
        >
          <div className="coach-recommendation-body">
            {best ? (
              <p className="best">
                <span className="uci">{best.uci}</span>
                <span className="eval">{best.evalLabel}</span>
                <span className="meta-inline">
                  {best.from} → {best.to}
                </span>
              </p>
            ) : (
              <p className="meta">
                {analysisStatus === 'loading'
                  ? 'Looking up best move…'
                  : 'No best move for this position.'}
              </p>
            )}
            {analysisError && <p className="error">{analysisError}</p>}

            {(coachNote || coachStatus === 'loading') && (
              <p className="coach-note" aria-live="polite">
                {coachStatus === 'loading' && !coachNote
                  ? 'Asking coach…'
                  : coachNote}
              </p>
            )}
            {coachError && <p className="error">{coachError}</p>}

            <div className="btn-row">
              <button
                type="button"
                onClick={onAskCoach}
                disabled={!best || coachStatus === 'loading' || !coachEnabled}
              >
                {coachStatus === 'loading' ? 'Asking coach…' : 'Ask coach'}
              </button>
            </div>
          </div>
          <div className="coach-recommendation-veil" aria-hidden={coachEnabled}>
            {!coachEnabled && <span>Enable tips to reveal</span>}
          </div>
        </div>

        {coachEnabled && (
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
        )}

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