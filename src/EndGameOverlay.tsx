import { useState, type CSSProperties } from 'react'
import { BorderBeam } from 'border-beam'
import { PixelButton } from '@/components/ui/PixelButton'
import { PixelHeading } from '@/components/ui/pixel-heading-character'

type Outcome = 'win' | 'loss' | 'draw' | 'over'

const MESSAGES: Record<Outcome, string> = {
  win: 'You won!',
  loss: 'You lost',
  draw: 'Draw',
  over: 'Game over',
}

type Props = {
  outcome: Outcome
  onNewGame: () => void | Promise<void>
  onDismiss: () => void
  onReviewGame?: () => void
  reviewBusy?: boolean
  reviewProgress?: string | null
  reviewError?: string | null
  canReview?: boolean
}

function EndGameCard({
  outcome,
  onNewGame,
  onDismiss,
  onReviewGame,
  starting,
  reviewBusy,
  reviewProgress,
  reviewError,
  canReview,
}: Props & { starting: boolean }) {
  return (
    <div className={`endgame-card endgame-${outcome}`}>
      <p className="endgame-eyebrow">
        {outcome === 'win' || outcome === 'loss' ? 'Checkmate' : 'Finished'}
      </p>
      <PixelHeading
        as="h2"
        mode="wave"
        autoPlay
        cycleInterval={110}
        staggerDelay={40}
        className="endgame-title"
      >
        {MESSAGES[outcome]}
      </PixelHeading>
      {reviewProgress && (
        <p className="endgame-review-status">{reviewProgress}</p>
      )}
      {reviewError && <p className="error">{reviewError}</p>}
      <div className="endgame-actions">
        {canReview && onReviewGame && (
          <PixelButton onClick={onReviewGame} disabled={starting || reviewBusy}>
            {reviewBusy ? 'Reviewing…' : 'Review game'}
          </PixelButton>
        )}
        <PixelButton onClick={onNewGame} disabled={starting || reviewBusy}>
          {starting ? 'Starting…' : 'New game'}
        </PixelButton>
        <PixelButton ghost onClick={onDismiss} disabled={starting || reviewBusy}>
          Close
        </PixelButton>
      </div>
    </div>
  )
}

export function EndGameOverlay({
  outcome,
  onNewGame,
  onDismiss,
  onReviewGame,
  reviewBusy = false,
  reviewProgress = null,
  reviewError = null,
  canReview = false,
}: Props) {
  const confetti = outcome === 'win'
  const [starting, setStarting] = useState(false)

  async function handleNewGame() {
    if (starting || reviewBusy) return
    setStarting(true)
    try {
      await new Promise<void>((r) => window.setTimeout(r, 900))
      await onNewGame()
    } catch {
      setStarting(false)
    }
  }

  const card = (
    <EndGameCard
      outcome={outcome}
      onNewGame={handleNewGame}
      onDismiss={onDismiss}
      onReviewGame={onReviewGame}
      starting={starting}
      reviewBusy={reviewBusy}
      reviewProgress={reviewProgress}
      reviewError={reviewError}
      canReview={canReview}
    />
  )

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
      {outcome === 'win' || reviewBusy ? (
        <BorderBeam
          className={[
            'endgame-beam',
            starting || reviewBusy ? 'endgame-beam-loading' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          size="md"
          colorVariant="ocean"
          theme="dark"
          duration={starting || reviewBusy ? 1.1 : 2.4}
          borderRadius={14}
          strength={starting || reviewBusy ? 1.35 : 0.85}
          brightness={starting || reviewBusy ? 2.8 : 1.6}
          saturation={1.6}
          hueRange={50}
          active={starting || reviewBusy}
        >
          {card}
        </BorderBeam>
      ) : (
        card
      )}
    </div>
  )
}

export function outcomeFromResult(
  gameOver: {
    type: string
    winner: 'white' | 'black' | null
  } | null,
  playerColor: 'white' | 'black',
): Outcome | null {
  if (!gameOver) return null
  if (gameOver.type === 'stalemate' || gameOver.type === 'draw') return 'draw'
  if (gameOver.type === 'checkmate' || gameOver.type === 'resign') {
    if (!gameOver.winner) return 'over'
    return gameOver.winner === playerColor ? 'win' : 'loss'
  }
  return 'over'
}
