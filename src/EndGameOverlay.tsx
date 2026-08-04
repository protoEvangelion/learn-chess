import type { CSSProperties } from 'react'

type Outcome = 'win' | 'loss' | 'draw' | 'over'

const MESSAGES: Record<Outcome, string> = {
  win: 'You won!',
  loss: 'You lost',
  draw: 'Draw',
  over: 'Game over',
}

type Props = {
  outcome: Outcome
  onNewGame: () => void
  onDismiss: () => void
}

export function EndGameOverlay({ outcome, onNewGame, onDismiss }: Props) {
  const confetti = outcome === 'win'

  return (
    <div
      className="endgame-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={MESSAGES[outcome]}
    >
      {confetti && (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 48 }, (_, i) => (
            <span
              key={i}
              className="confetti-piece"
              style={
                {
                  '--x': `${(i * 37) % 100}%`,
                  '--delay': `${(i % 12) * 0.08}s`,
                  '--dur': `${2.4 + (i % 5) * 0.35}s`,
                  '--rot': `${(i * 47) % 360}deg`,
                  '--hue': `${(i * 29) % 360}`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
      <div className={`endgame-card endgame-${outcome}`}>
        <p className="endgame-eyebrow">
          {outcome === 'win' || outcome === 'loss' ? 'Checkmate' : 'Finished'}
        </p>
        <h2 className="endgame-title">{MESSAGES[outcome]}</h2>
        <div className="endgame-actions">
          <button type="button" onClick={onNewGame}>
            New game
          </button>
          <button type="button" className="ghost" onClick={onDismiss}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export function outcomeFromResult(
  gameOver: { type: string; winner: 'white' | 'black' } | null,
  playerColor: 'white' | 'black',
): Outcome | null {
  if (!gameOver) return null
  if (gameOver.type === 'stalemate') return 'draw'
  if (gameOver.type === 'checkmate') {
    return gameOver.winner === playerColor ? 'win' : 'loss'
  }
  return 'over'
}
