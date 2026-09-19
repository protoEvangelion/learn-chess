import { useEffect, useRef, useState, type FC, type FormEvent } from 'react'
import { BorderBeam } from 'border-beam'
import type { BestMoveResult } from '@/lib/stockfishOpponent'
import { BgAnimateButton } from '@/components/ui/BgAnimateButton'
import { PixelButton } from '@/components/ui/PixelButton'
import { PanelResizeHandle } from '@/components/PanelResizeHandle'

export type CoachChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

type MoveRow = {
  line: BestMoveResult
  san: string
}

type Props = {
  open: boolean
  onClose: () => void
  fen: string
  lines: BestMoveResult[]
  selectedIndex: number
  onSelectIndex: (index: number) => void
  isPlayerTurn: boolean
  analysisStatus: 'idle' | 'loading' | 'error'
  analysisError: string | null
  explanation: string | null
  coachStatus: 'idle' | 'loading' | 'error'
  coachError: string | null
  onAskCoach: () => void
  chatMessages: CoachChatMessage[]
  chatStatus: 'idle' | 'loading' | 'error'
  chatError: string | null
  onSendChat: (question: string) => void
  /** Post-game recap: hide live top-moves, allow chat. */
  reviewMode?: boolean
  panelWidth: number
  onPanelWidthChange: (width: number) => void
  onPanelResizeEnd?: (width: number) => void
}

function formatPoints(line: BestMoveResult): string {
  if (line.whiteMate != null) {
    const n = Math.abs(line.whiteMate)
    return line.whiteMate > 0 ? `M${n}` : `−M${n}`
  }
  if (line.whiteCp != null) {
    const p = line.whiteCp / 100
    const abs = Math.abs(p).toFixed(2)
    return p > 0 ? `+${abs}` : p < 0 ? `−${abs}` : '0.00'
  }
  return line.evalLabel || '—'
}

export const CoachDialog: FC<Props> = ({
  open,
  onClose,
  fen,
  lines,
  selectedIndex,
  onSelectIndex,
  isPlayerTurn,
  analysisStatus,
  analysisError,
  explanation,
  coachStatus,
  coachError,
  onAskCoach,
  chatMessages,
  chatStatus,
  chatError,
  onSendChat,
  reviewMode = false,
  panelWidth,
  onPanelWidthChange,
  onPanelResizeEnd,
}) => {
  const [draft, setDraft] = useState('')
  const [moveRows, setMoveRows] = useState<MoveRow[]>([])
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (lines.length === 0) {
        setMoveRows([])
        return
      }
      const { Chess } = await import('chess.js')
      if (cancelled) return
      const rows: MoveRow[] = []
      for (const line of lines) {
        let san = `${line.from}→${line.to}`
        try {
          const chess = new Chess(fen)
          const played = chess.move({
            from: line.from,
            to: line.to,
            promotion: line.uci.length > 4 ? line.uci[4] : undefined,
          })
          if (played) san = played.san
        } catch {
          /* keep square label */
        }
        rows.push({ line, san })
      }
      setMoveRows(rows)
    })()
    return () => {
      cancelled = true
    }
  }, [fen, lines])

  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chatMessages, chatStatus])

  const analysisBusy = analysisStatus === 'loading'
  const canAsk =
    !reviewMode &&
    isPlayerTurn &&
    !analysisBusy &&
    lines.length > 0 &&
    coachStatus !== 'loading'
  const chatBusy = chatStatus === 'loading'
  const chatReady = reviewMode || isPlayerTurn

  function submitChat(e?: FormEvent) {
    e?.preventDefault()
    const q = draft.trim()
    if (!q || !chatReady || chatBusy) return
    setDraft('')
    onSendChat(q)
  }

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
        <PanelResizeHandle
          width={panelWidth}
          onWidthChange={onPanelWidthChange}
          onResizeEnd={onPanelResizeEnd}
        />
        <header className="coach-dialog-header">
          <div className="coach-dialog-title">
            <p className="coach-eyebrow">{reviewMode ? 'Recap' : 'Hints'}</p>
            <h2>{reviewMode ? 'Game review' : 'Coach'}</h2>
          </div>
          <PixelButton ghost onClick={onClose}>
            Close
          </PixelButton>
        </header>

        <div className="coach-dialog-scroll">
          {analysisError && <p className="error">{analysisError}</p>}
          {coachError && <p className="error">{coachError}</p>}

          {!reviewMode && !isPlayerTurn && (
            <p className="coach-status">
              Waiting for the opponent… coach resumes on your turn.
            </p>
          )}

          {!reviewMode && isPlayerTurn && !analysisBusy && lines.length === 0 && (
            <p className="coach-status">No engine lines for this position.</p>
          )}

          {!reviewMode && isPlayerTurn && (analysisBusy || lines.length > 0) && (
            <section
              className="coach-moves"
              aria-label="Top engine moves"
              aria-busy={analysisBusy || moveRows.length === 0 || undefined}
            >
              <p className="coach-chat-label">Top moves</p>
              <ul className="coach-move-list">
                {moveRows.length > 0 && !analysisBusy
                  ? moveRows.map((row, i) => {
                      const selected = i === selectedIndex
                      return (
                        <li key={row.line.uci}>
                          <button
                            type="button"
                            className={[
                              'coach-move-row',
                              selected ? 'is-selected' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onClick={() => onSelectIndex(i)}
                            aria-pressed={selected}
                          >
                            <span className="coach-move-rank">{i + 1}</span>
                            <span className="coach-move-san">{row.san}</span>
                            <span className="coach-move-squares">
                              {row.line.from}→{row.line.to}
                            </span>
                            <span className="coach-move-eval" title="Eval (White)">
                              {formatPoints(row.line)}
                            </span>
                          </button>
                        </li>
                      )
                    })
                  : [1, 2, 3].map((n) => (
                      <li key={n}>
                        <button
                          type="button"
                          className="coach-move-row is-skel"
                          disabled
                          tabIndex={-1}
                          aria-hidden
                        >
                          <span className="coach-move-rank">{n}</span>
                          <span className="coach-move-san">Nf3</span>
                          <span className="coach-move-squares">e2→e4</span>
                          <span className="coach-move-eval">+0.00</span>
                        </button>
                      </li>
                    ))}
              </ul>
              <BgAnimateButton
                className="coach-ask-btn"
                animation="spin-slow"
                gradient="ocean"
                onClick={onAskCoach}
                disabled={!canAsk}
                loading={coachStatus === 'loading'}
              >
                {coachStatus === 'loading'
                  ? 'Writing tips…'
                  : explanation
                    ? 'Ask coach again'
                    : 'Ask coach about moves'}
              </BgAnimateButton>
            </section>
          )}

          {coachStatus === 'loading' && !explanation && (
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

          {explanation && (
            <div className="coach-panel coach-explain-card">
              <p className="coach-loading-label">
                {reviewMode ? 'Game review' : 'Coach'}
              </p>
              <p className="coach-explain-body">{explanation}</p>
            </div>
          )}

          <section className="coach-chat" aria-label="Ask the coach">
            <p className="coach-chat-label">Chat</p>
            <div className="coach-chat-thread" ref={threadRef}>
              {chatMessages.length === 0 && (
                <p className="coach-chat-empty">
                  {chatReady
                    ? 'e.g. “Why this piece?” or “What if they take?”'
                    : 'Waiting for your turn…'}
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
        </div>

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
      </aside>
    </div>
  )
}
