import type { FC } from 'react'
import type { BestMoveResult } from '@/lib/stockfishOpponent'
import { advantageFromBest } from '@/lib/advantage'
import { materialFromFen, materialGlyphs } from '@/lib/material'

type Props = {
  fen: string
  best: BestMoveResult | null
  analysisStatus: 'idle' | 'loading' | 'error'
}

/** Compact white/black odds + captures beside the FPS meter. */
export const HudEval: FC<Props> = ({ fen, best, analysisStatus }) => {
  const advantage = advantageFromBest(best)
  const material = materialFromFen(fen)
  const barWhite = advantage?.whitePercent ?? 50
  const oddsLabel = advantage
    ? advantage.label === 'Even'
      ? `Even ${advantage.detail}`
      : `${advantage.label[0]} ${advantage.detail}`
    : analysisStatus === 'loading'
      ? '…'
      : '—'

  return (
    <div className="hud-eval" aria-label="Evaluation and material">
      <div
        className="hud-eval-bar"
        title={
          advantage
            ? `Engine: ${advantage.label} ${advantage.detail}`
            : 'Evaluating…'
        }
      >
        <div className="hud-eval-bar-white" style={{ width: `${barWhite}%` }} />
        <span className="hud-eval-bar-label">{oddsLabel}</span>
      </div>
      <div className="hud-material">
        <span className="hud-mat-side" title="White captures">
          <span className="hud-mat-tag">W</span>
          <span className="hud-mat-pieces" aria-hidden="true">
            {materialGlyphs(material.whiteCaptures) || '·'}
          </span>
          {material.whiteScore > 0 && (
            <span className="hud-mat-score">+{material.whiteScore}</span>
          )}
        </span>
        <span className="hud-mat-side" title="Black captures">
          <span className="hud-mat-tag">B</span>
          <span className="hud-mat-pieces" aria-hidden="true">
            {materialGlyphs(material.blackCaptures) || '·'}
          </span>
          {material.whiteScore < 0 && (
            <span className="hud-mat-score">
              +{Math.abs(material.whiteScore)}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
