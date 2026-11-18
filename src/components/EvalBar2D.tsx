import type { FC } from 'react'

type Props = {
  /** 0–100, White's share. White fills from the bottom. */
  whitePercent: number
  /** Short score, e.g. "+0.20", "0.00", "mate in 3". */
  label: string
}

/** Vertical eval bar beside the flat board. */
export const EvalBar2D: FC<Props> = ({ whitePercent, label }) => {
  const white = Math.max(0, Math.min(100, whitePercent))
  return (
    <div
      className="board-2d-eval"
      role="img"
      aria-label={`Evaluation ${label}`}
    >
      <div className="board-2d-eval-track">
        <div
          className="board-2d-eval-white"
          style={{ height: `${white}%` }}
        />
      </div>
      <span className="board-2d-eval-label">{label}</span>
    </div>
  )
}
