import { useMemo, type FC } from 'react'
import { Button } from '@/components/ui/button'
import { PixelButton } from '@/components/ui/PixelButton'
import { PanelResizeHandle } from '@/components/PanelResizeHandle'
import {
  CoachPane,
  type CoachChatMessage,
} from '@/components/CoachPane'
import { buildPlyTimeline } from '@/lib/gameReview'
import type { Color } from '@logic/pieces'
import type { HistoryItem } from '@/state/game'

export type GameTabId = 'moves' | 'coach'

type Props = {
  open: boolean
  onClose: () => void
  onNewGame: () => void
  tab: GameTabId
  onTabChange: (tab: GameTabId) => void
  history: HistoryItem[]
  playerColor: Color
  explanation: string | null
  coachStatus: 'idle' | 'loading' | 'error'
  coachError: string | null
  chatMessages: CoachChatMessage[]
  chatStatus: 'idle' | 'loading' | 'error'
  chatError: string | null
  onSendChat: (question: string) => void
  isPlayerTurn: boolean
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
  tab,
  onTabChange,
  history,
  playerColor,
  explanation,
  coachStatus,
  coachError,
  chatMessages,
  chatStatus,
  chatError,
  onSendChat,
  isPlayerTurn,
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
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="game-new-btn"
                onClick={onNewGame}
              >
                New game
              </Button>
            )}
            <PixelButton ghost onClick={onClose}>
              Close
            </PixelButton>
          </div>
        </header>

        <div className="game-tabs" role="tablist" aria-label="Game panel">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'moves'}
            className={tab === 'moves' ? 'is-active' : ''}
            onClick={() => onTabChange('moves')}
          >
            Moves
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'coach'}
            className={tab === 'coach' ? 'is-active' : ''}
            onClick={() => onTabChange('coach')}
          >
            Coach
          </button>
        </div>

        <div className="game-dialog-body">
          {tab === 'moves' && (
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
          )}

          {tab === 'coach' && (
            <CoachPane
              explanation={explanation}
              coachStatus={coachStatus}
              coachError={coachError}
              chatMessages={chatMessages}
              chatStatus={chatStatus}
              chatError={chatError}
              onSendChat={onSendChat}
              isPlayerTurn={isPlayerTurn}
              reviewMode={reviewMode}
            />
          )}
        </div>
      </aside>
    </div>
  )
}
