import { useEffect, useState, type FC } from 'react'
import type { Color } from '@logic/pieces'
import type { GameMode } from '@/lib/playMode'
import { BgAnimateButton } from '@/components/ui/BgAnimateButton'
import { PixelButton } from '@/components/ui/PixelButton'

type Props = {
  open: boolean
  mode: GameMode
  onClose: () => void
  onPick: (color: Color, mode: GameMode) => void
}

export const NewGameDialog: FC<Props> = ({ open, mode, onClose, onPick }) => {
  const [draftMode, setDraftMode] = useState<GameMode>(mode)

  useEffect(() => {
    if (open) setDraftMode(mode)
  }, [open, mode])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const pvp = draftMode === 'pvp'

  return (
    <div
      className="new-game-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="new-game-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-game-title"
      >
        <p className="new-game-eyebrow">New game</p>
        <h2 id="new-game-title">Mode</h2>
        <div
          className="board-view-switch new-game-mode"
          role="radiogroup"
          aria-label="Game mode"
        >
          {(
            [
              { id: 'computer', label: 'vs Computer' },
              { id: 'pvp', label: 'Two players' },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={draftMode === option.id}
              className={`board-view-option${draftMode === option.id ? ' active' : ''}`}
              onClick={() => setDraftMode(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <h2>{pvp ? 'Board from' : 'Play as'}</h2>
        <div className="new-game-sides">
          <BgAnimateButton
            gradient="ocean"
            onClick={() => onPick('white', draftMode)}
          >
            White
          </BgAnimateButton>
          <BgAnimateButton
            gradient="nebula"
            onClick={() => onPick('black', draftMode)}
          >
            Black
          </BgAnimateButton>
        </div>
        <PixelButton ghost onClick={onClose}>
          Cancel
        </PixelButton>
      </div>
    </div>
  )
}
