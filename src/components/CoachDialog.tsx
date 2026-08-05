import { useEffect, useRef, useState, type FC, type FormEvent } from 'react'
import type { BestMoveResult } from '@/lib/stockfishOpponent'
import type { CoachTips } from '@/lib/coachTips'
import { PixelButton } from '@/components/ui/PixelButton'

export type CoachChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

type Props = {
  open: boolean
  onClose: () => void
  best: BestMoveResult | null
  /** When false, coach waits instead of tipping the opponent’s move. */
  isPlayerTurn: boolean
  analysisStatus: 'idle' | 'loading' | 'error'
  analysisError: string | null
  coachTips: CoachTips | null
  coachStatus: 'idle' | 'loading' | 'error'
  coachError: string | null
  tip3Open: boolean
  onTip3OpenChange: (open: boolean) => void
  chatMessages: CoachChatMessage[]
  chatStatus: 'idle' | 'loading' | 'error'
  chatError: string | null
  onSendChat: (question: string) => void
}

function TipRow({
  label,
  body,
  open,
  onOpenChange,
  accent,
}: {
  label: string
  body: string
  open: boolean
  onOpenChange: (open: boolean) => void
  accent?: boolean
}) {
  return (
    <details
      className={['coach-tip', accent ? 'coach-tip-accent' : '']
        .filter(Boolean)
        .join(' ')}
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open
        if (next !== open) onOpenChange(next)
      }}
    >
      <summary>{label}</summary>
      <p className="coach-tip-body">{body}</p>
    </details>
  )
}

export const CoachDialog: FC<Props> = ({
  open,
  onClose,
  best,
  isPlayerTurn,
  analysisStatus,
  analysisError,
  coachTips,
  coachStatus,
  coachError,
  tip3Open,
  onTip3OpenChange,
  chatMessages,
  chatStatus,
  chatError,
  onSendChat,
}) => {
  const [tip1Open, setTip1Open] = useState(true)
  const [tip2Open, setTip2Open] = useState(false)
  const [draft, setDraft] = useState('')
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!coachTips) return
    setTip1Open(true)
    setTip2Open(false)
  }, [coachTips])

  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chatMessages, chatStatus])

  const statusLine = coachTips
    ? null
    : !isPlayerTurn
      ? 'Waiting for the opponent… tips resume on your turn.'
      : coachStatus === 'loading'
        ? 'Writing tips…'
        : analysisStatus === 'loading'
          ? 'Looking up best move…'
          : coachError
            ? null
            : best
              ? 'Preparing coach tips…'
              : 'No best move for this position.'

  const chatReady = !!coachTips
  const chatBusy = chatStatus === 'loading'

  function submitChat(e?: FormEvent) {
    e?.preventDefault()
    const q = draft.trim()
    if (!q || !chatReady || chatBusy) return
    setDraft('')
    onSendChat(q)
  }

  // Stay mounted when closed so tip accordion + draft survive reopen.
  return (
    <div
      className={['coach-backdrop', open ? '' : 'is-closed'].filter(Boolean).join(' ')}
      onClick={open ? onClose : undefined}
      role="presentation"
      aria-hidden={!open}
    >
      <aside
        className="coach-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Coach"
        inert={!open ? true : undefined}
      >
        <header className="coach-dialog-header">
          <div className="coach-dialog-title">
            <p className="coach-eyebrow">Hints</p>
            <h2>Coach</h2>
          </div>
          <PixelButton ghost onClick={onClose}>
            Close
          </PixelButton>
        </header>

        {analysisError && <p className="error">{analysisError}</p>}
        {coachError && <p className="error">{coachError}</p>}

        {statusLine && <p className="coach-status">{statusLine}</p>}

        {coachTips && (
          <div className="coach-tips">
            <TipRow
              label="1 · Nudge"
              body={coachTips.tip1}
              open={tip1Open}
              onOpenChange={setTip1Open}
            />
            <TipRow
              label="2 · Closer look"
              body={coachTips.tip2}
              open={tip2Open}
              onOpenChange={setTip2Open}
            />
            <TipRow
              label="3 · Recommended move"
              body={coachTips.tip3}
              open={tip3Open}
              onOpenChange={onTip3OpenChange}
              accent
            />
          </div>
        )}

        {chatReady && (
          <section className="coach-chat" aria-label="Ask the coach">
            <p className="coach-chat-label">Ask about these tips</p>
            <div className="coach-chat-thread" ref={threadRef}>
              {chatMessages.length === 0 && (
                <p className="coach-chat-empty">
                  e.g. “Why this piece?” or “What if they take?”
                </p>
              )}
              {chatMessages.map((m) => (
                <div
                  key={m.id}
                  className={[
                    'coach-chat-bubble',
                    m.role === 'user' ? 'is-user' : 'is-assistant',
                  ].join(' ')}
                >
                  {m.text || (chatBusy ? '…' : '')}
                </div>
              ))}
            </div>
            {chatError && <p className="error">{chatError}</p>}
            <form className="coach-chat-form" onSubmit={submitChat}>
              <input
                type="text"
                className="coach-chat-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask a follow-up…"
                disabled={chatBusy}
                aria-label="Question for the coach"
                autoComplete="off"
              />
              <PixelButton
                type="submit"
                disabled={chatBusy || !draft.trim()}
                aria-label="Send"
              >
                Send
              </PixelButton>
            </form>
          </section>
        )}
      </aside>
    </div>
  )
}
