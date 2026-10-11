import type { FC } from 'react'
import { PanelResizeHandle } from '@/components/PanelResizeHandle'
import { PixelButton } from '@/components/ui/PixelButton'
import { CoachBotIcon } from '@/components/ui/gradient-button-group'
import {
  CoachPane,
  type CoachChatMessage,
} from '@/components/CoachPane'

type Props = {
  open: boolean
  onClose: () => void
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

export const CoachPanel: FC<Props> = ({
  open,
  onClose,
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
}) => (
  <div
    className={['coach-backdrop', open ? '' : 'is-closed'].filter(Boolean).join(' ')}
    role="presentation"
    aria-hidden={!open}
  >
    <aside
      className="coach-dialog"
      role="dialog"
      aria-label="Coach"
      inert={!open ? true : undefined}
    >
      <PanelResizeHandle
        width={panelWidth}
        onWidthChange={onPanelWidthChange}
        onResizeEnd={onPanelResizeEnd}
      />
      <header className="coach-dialog-header">
        <div className="coach-dialog-mark">
          <span className="coach-dialog-glyph" aria-hidden="true">
            <CoachBotIcon />
          </span>
          <div className="coach-dialog-title">
            <p className="coach-eyebrow">{reviewMode ? 'Recap' : 'Ask'}</p>
            <h2>Coach</h2>
          </div>
        </div>
        <PixelButton ghost onClick={onClose}>
          Close
        </PixelButton>
      </header>
      <div className="coach-dialog-body">
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
      </div>
    </aside>
  </div>
)
