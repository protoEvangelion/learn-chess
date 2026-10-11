import { useEffect, type FC } from 'react'
import type { Color } from '@logic/pieces'
import { BgAnimateButton } from '@/components/ui/BgAnimateButton'
import { PixelButton } from '@/components/ui/PixelButton'

type Props = {
  open: boolean
  onClose: () => void
  onPick: (color: Color) => void
}

export const NewGameDialog: FC<Props> = ({ open, onClose, onPick }) => {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

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
        <h2 id="new-game-title">Play as</h2>
        <div className="new-game-sides">
          <BgAnimateButton gradient="ocean" onClick={() => onPick('white')}>
            White
          </BgAnimateButton>
          <BgAnimateButton gradient="nebula" onClick={() => onPick('black')}>
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
