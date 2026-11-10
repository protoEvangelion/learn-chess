import { useEffect, useRef, useState, type FC, type FormEvent } from 'react'
import { BorderBeam } from 'border-beam'
import { PixelButton } from '@/components/ui/PixelButton'

export type CoachChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

type Props = {
  explanation: string | null
  coachStatus: 'idle' | 'loading' | 'error'
  coachError: string | null
  chatMessages: CoachChatMessage[]
  chatStatus: 'idle' | 'loading' | 'error'
  chatError: string | null
  onSendChat: (question: string) => void
  isPlayerTurn: boolean
  /** Post-game recap: allow chat regardless of turn. */
  reviewMode?: boolean
  /** Practice: always allow chat (wrong-move coaching). */
  drillMode?: boolean
  emptyHint?: string
  /** Input only, until the user has started a thread. */
  compact?: boolean
  /** Shared with the other panel so an unsent question survives the switch. */
  draft?: string
  onDraftChange?: (value: string) => void
}

/** Chat-first coach UI — optional explain card + thread. */
export const CoachPane: FC<Props> = ({
  explanation,
  coachStatus,
  coachError,
  chatMessages,
  chatStatus,
  chatError,
  onSendChat,
  isPlayerTurn,
  reviewMode = false,
  drillMode = false,
  emptyHint,
  compact = false,
  draft: draftProp,
  onDraftChange,
}) => {
  const [localDraft, setLocalDraft] = useState('')
  const draft = onDraftChange ? (draftProp ?? '') : localDraft
  function setDraft(value: string) {
    if (onDraftChange) onDraftChange(value)
    else setLocalDraft(value)
  }
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chatMessages, chatStatus])

  const chatBusy = chatStatus === 'loading'
  const chatReady = reviewMode || drillMode || isPlayerTurn
  const askBusy = coachStatus === 'loading'

  function submitChat(e?: FormEvent) {
    e?.preventDefault()
    const q = draft.trim()
    if (!q || !chatReady || chatBusy) return
    setDraft('')
    onSendChat(q)
  }

  if (compact) {
    // Review dock: the recap is the first chat message, above the input.
    const showRecap = reviewMode && (explanation || askBusy)
    return (
      <div className="coach-pane is-compact">
        {coachError ? <p className="error">{coachError}</p> : null}
        {showRecap ? (
          <div className="coach-chat-thread is-dock-thread" ref={threadRef}>
            {explanation ? (
              <div className="coach-chat-bubble is-assistant is-recap">
                {explanation}
              </div>
            ) : (
              <div
                className="coach-chat-bubble is-assistant is-recap is-loading"
                aria-busy="true"
              >
                Writing recap…
              </div>
            )}
          </div>
        ) : null}
        <form className="coach-chat-form" onSubmit={submitChat}>
          <input
            type="text"
            className="coach-chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              chatReady ? 'Ask the coach…' : 'Waiting for your turn…'
            }
            disabled={!chatReady || chatBusy}
            aria-label="Question for the coach"
            autoComplete="off"
          />
          <PixelButton
            type="submit"
            disabled={!chatReady || chatBusy || !draft.trim()}
            aria-label="Send"
          >
            Send
          </PixelButton>
        </form>
      </div>
    )
  }

  return (
    <div className="coach-pane">
      {coachError && <p className="error">{coachError}</p>}

      {!reviewMode && !drillMode && !isPlayerTurn && (
        <p className="coach-status">
          Waiting for the opponent… coach resumes on your turn.
        </p>
      )}

      {askBusy && !explanation && !reviewMode && (
        <BorderBeam
          className="coach-panel-beam"
          size="pulse-inner"
          colorVariant="ocean"
          theme="dark"
          duration={2.2}
          borderRadius={12}
          strength={0.95}
          brightness={1.8}
          active
        >
          <div
            className="coach-panel coach-panel-loading"
            aria-busy="true"
            aria-label="Writing tips"
          >
            <p className="coach-loading-label">
              {reviewMode ? 'Writing recap' : 'Drafting tips'}
            </p>
            <div className="coach-skel-block">
              <div className="coach-skel-line w-92" />
              <div className="coach-skel-line w-78" />
              <div className="coach-skel-line w-64" />
              <div className="coach-skel-line w-88" />
              <div className="coach-skel-line w-70" />
            </div>
          </div>
        </BorderBeam>
      )}

      {/* Live tips stay a card; the post-game recap is the first chat message. */}
      {explanation && !reviewMode && (
        <div className="coach-panel coach-explain-card">
          <p className="coach-loading-label">Coach</p>
          <p className="coach-explain-body">{explanation}</p>
        </div>
      )}

      <section className="coach-chat" aria-label="Ask the coach">
        <div className="coach-chat-thread" ref={threadRef}>
          {reviewMode && explanation ? (
            <div className="coach-chat-bubble is-assistant is-recap">
              {explanation}
            </div>
          ) : null}
          {reviewMode && askBusy && !explanation ? (
            <div
              className="coach-chat-bubble is-assistant is-recap is-loading"
              aria-busy="true"
            >
              Writing recap…
            </div>
          ) : null}
          {chatMessages.length === 0 &&
            !(reviewMode && (explanation || askBusy)) &&
            emptyHint !== '' && (
              <p className="coach-chat-empty">
                {emptyHint ??
                  (chatReady
                    ? 'e.g. “Why this piece?” or “What if they take?”'
                    : 'Waiting for your turn…')}
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
      </section>

      <form className="coach-chat-form" onSubmit={submitChat}>
        <input
          type="text"
          className="coach-chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            chatReady ? 'Ask the coach…' : 'Waiting for your turn…'
          }
          disabled={!chatReady || chatBusy}
          aria-label="Question for the coach"
          autoComplete="off"
        />
        <PixelButton
          type="submit"
          disabled={!chatReady || chatBusy || !draft.trim()}
          aria-label="Send"
        >
          Send
        </PixelButton>
      </form>
    </div>
  )
}
