import type { FC } from 'react'
import { materialFromFen, materialGlyphs } from '@/lib/material'

type Props = {
  fen: string
}

/** Captured-piece strip in the HUD. Eval lives on the 3D board-edge pillar. */
export const HudEval: FC<Props> = ({ fen }) => {
  const material = materialFromFen(fen)

  return (
    <div className="hud-eval" aria-label="Material">
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
