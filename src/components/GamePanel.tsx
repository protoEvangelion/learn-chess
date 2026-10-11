import { useMemo, type FC } from 'react'
import { BgAnimateButton } from '@/components/ui/BgAnimateButton'
import { PixelButton } from '@/components/ui/PixelButton'
import { PanelResizeHandle } from '@/components/PanelResizeHandle'
import { buildPlyTimeline } from '@/lib/gameReview'
import type { Color } from '@logic/pieces'
import type { HistoryItem } from '@/state/game'

type Props = {
  open: boolean
  onClose: () => void
  onNewGame: () => void
  history: HistoryItem[]
  playerColor: Color
  reviewMode?: boolean
  panelWidth: number
  onPanelWidthChange: (width: number) => void
  onPanelResizeEnd?: (width: number) => void
}

function groupSans(
  history: HistoryItem[],
  playerColor: Color,
): Array<{ moveNo: number; white?: string; black?: string }> {
  if (history.length === 0) return []
  const plies = buildPlyTimeline(history, playerColor)
  const rows: Array<{ moveNo: number; white?: string; black?: string }> = []
  for (const ply of plies) {
    const moveNo = Math.ceil(ply.ply / 2)
    let row = rows.find((r) => r.moveNo === moveNo)
    if (!row) {
      row = { moveNo }
      rows.push(row)
    }
    if (ply.color === 'white') row.white = ply.san
    else row.black = ply.san
  }
  return rows
}

export const GamePanel: FC<Props> = ({
  open,
  onClose,
  onNewGame,
  history,
  playerColor,
  reviewMode = false,
  panelWidth,
  onPanelWidthChange,
  onPanelResizeEnd,
}) => {
  const moveRows = useMemo(
    () => groupSans(history, playerColor),
    [history, playerColor],
  )

  return (
    <div
      className={['game-backdrop', open ? '' : 'is-closed']
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      aria-hidden={!open}
    >
      <aside
        className="game-dialog"
        role="dialog"
        aria-label="Game"
        inert={!open ? true : undefined}
      >
        <PanelResizeHandle
          width={panelWidth}
          onWidthChange={onPanelWidthChange}
          onResizeEnd={onPanelResizeEnd}
        />
        <header className="game-dialog-header">
          <div className="game-dialog-title">
            <p className="game-eyebrow">{reviewMode ? 'Recap' : 'Play'}</p>
            <h2>{reviewMode ? 'Game review' : 'Game'}</h2>
          </div>
          <div className="game-dialog-header-actions">
            {!reviewMode && (
              <BgAnimateButton
                className="game-new-btn"
                gradient="nebula"
                animation="spin-slow"
                onClick={onNewGame}
              >
                New game
              </BgAnimateButton>
            )}
            <PixelButton ghost onClick={onClose}>
              Close
            </PixelButton>
          </div>
        </header>

        <div className="game-dialog-body">
          <div className="game-moves" aria-label="Move list">
            {moveRows.length === 0 ? (
              <p className="game-moves-empty">
                Moves will appear here as you play.
              </p>
            ) : (
              <ol className="game-move-list">
                {moveRows.map((row) => (
                  <li key={row.moveNo} className="game-move-row">
                    <span className="game-move-no">{row.moveNo}.</span>
                    <span className="game-move-san">{row.white ?? '…'}</span>
                    <span className="game-move-san">{row.black ?? ''}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}
