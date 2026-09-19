import { type FC } from 'react'
import { ExternalLink, Lightbulb, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PixelButton } from '@/components/ui/PixelButton'
import { PanelResizeHandle } from '@/components/PanelResizeHandle'
import { ConfettiBurst } from '@/components/ConfettiBurst'
import {
  CoachPane,
  type CoachChatMessage,
} from '@/components/CoachPane'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { italianLinesByFamily } from '@/lib/drills/italian'
import { drillLineSourceUrl } from '@/lib/drills/engine'
import type { DrillLine, DrillProgress } from '@/lib/drills/types'
import { DRILL_FAMILIES } from '@/lib/drills/types'
import { drillStats } from '@/lib/drills/progress'

type Props = {
  open: boolean
  onClose: () => void
  line: DrillLine | null
  plyIndex: number
  hint: string
  wrongFlash?: boolean
  mistakeMessage?: string | null
  onTryAgain?: () => void
  progress: DrillProgress
  onSelectLine: (lineId: string) => void
  onRestart: () => void
  onShowHint: () => void
  hintRevealed: boolean
  status: 'idle' | 'playing' | 'complete'
  /** Clean clear (no wrong moves) — triggers confetti. */
  celebrate?: boolean
  onScrubPly?: (index: number) => void
  scrubMax?: number
  panelWidth: number
  onPanelWidthChange: (width: number) => void
  onPanelResizeEnd?: (width: number) => void
  openingCardBlurb?: string | null
  openingCardStatus?: 'idle' | 'loading' | 'ready' | 'error'
  /** Embedded coach (no tabs). */
  coachExplanation?: string | null
  coachStatus?: 'idle' | 'loading' | 'error'
  coachError?: string | null
  coachChat?: CoachChatMessage[]
  coachChatStatus?: 'idle' | 'loading' | 'error'
  coachChatError?: string | null
  onSendCoachChat?: (question: string) => void
}

export const DrillDialog: FC<Props> = ({
  open,
  onClose,
  line,
  plyIndex,
  hint,
  wrongFlash = false,
  mistakeMessage = null,
  onTryAgain,
  progress,
  onSelectLine,
  onRestart,
  onShowHint,
  hintRevealed,
  status,
  celebrate = false,
  onScrubPly,
  scrubMax = 0,
  panelWidth,
  onPanelWidthChange,
  onPanelResizeEnd,
  openingCardBlurb: _openingCardBlurb = null,
  openingCardStatus: _openingCardStatus = 'idle',
  coachExplanation = null,
  coachStatus = 'idle',
  coachError = null,
  coachChat = [],
  coachChatStatus = 'idle',
  coachChatError = null,
  onSendCoachChat,
}) => {
  const stats = drillStats(progress)
  const lineGroups = italianLinesByFamily()
  const flatLines = lineGroups.flatMap((g) => g.lines)
  const lineIndex = line ? flatLines.findIndex((l) => l.id === line.id) : -1
  const familyMeta = line
    ? DRILL_FAMILIES.find((f) => f.id === line.family)
    : null

  const lineHref = line ? drillLineSourceUrl(line) : null

  const showCoach = Boolean(onSendCoachChat)
  const showHintBubble =
    Boolean(line) &&
    (status === 'complete' ||
      Boolean(mistakeMessage) ||
      wrongFlash ||
      hintRevealed)

  return (
    <div
      className={['drill-backdrop', open ? '' : 'is-closed']
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      aria-hidden={!open}
    >
      <aside
        className="drill-dialog"
        role="dialog"
        aria-label="Opening drill"
        inert={!open ? true : undefined}
      >
        <PanelResizeHandle
          width={panelWidth}
          onWidthChange={onPanelWidthChange}
          onResizeEnd={onPanelResizeEnd}
        />
        <ConfettiBurst active={celebrate && open} />
        <header className="drill-dialog-header">
          <div className="drill-dialog-title">
            <p className="drill-eyebrow">Opening drill</p>
            <h2>Italian Opening</h2>
          </div>
          <PixelButton ghost onClick={onClose}>
            Close
          </PixelButton>
        </header>

        <div className="drill-dialog-scroll">
          <div className="drill-progress-row">
            <span>
              Discovered {stats.discovered}/{stats.total}
            </span>
            <span>
              Perfected {stats.perfected}/{stats.total}
            </span>
          </div>

          <div className="drill-line-meta">
            <Select
              value={line?.id}
              onValueChange={(id) => {
                if (id) onSelectLine(id)
              }}
            >
              <SelectTrigger
                className="drill-line-select w-full"
                size="default"
                aria-label="Opening line"
              >
                <SelectValue placeholder="Pick a line to practice">
                  {line ? (
                    <span className="drill-line-select-row">
                      <span className="drill-line-family-chip">
                        {familyMeta?.label ?? 'Line'}
                      </span>
                      <span>{line.name}</span>
                    </span>
                  ) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent
                position="popper"
                align="start"
                className="drill-line-select-content max-h-72"
              >
                {lineGroups.map(({ family, lines }) => (
                  <SelectGroup key={family.id}>
                    <SelectLabel className="drill-line-group-label">
                      {family.label}
                      <span className="drill-line-group-blurb">
                        {family.blurb}
                      </span>
                    </SelectLabel>
                    {lines.map((l) => {
                      const globalIndex =
                        flatLines.findIndex((x) => x.id === l.id) + 1
                      const done = progress.discovered.includes(l.id)
                      const perfect = (progress.perfected[l.id] ?? 0) >= 3
                      const flag = perfect ? '★★★' : done ? '★' : ''
                      return (
                        <SelectItem key={l.id} value={l.id} textValue={l.name}>
                          <span className="drill-line-select-row">
                            <span className="text-muted-foreground">
                              #{globalIndex}
                            </span>
                            <span>{l.name}</span>
                            {flag ? (
                              <span className="text-muted-foreground">
                                {flag}
                              </span>
                            ) : null}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>

            <div
              className="drill-actions"
              role="group"
              aria-label="Drill actions"
            >
              <Button
                type="button"
                size="sm"
                variant={hintRevealed ? 'secondary' : 'default'}
                className="drill-action-btn"
                onClick={onShowHint}
                disabled={!line || status === 'complete' || hintRevealed}
                aria-pressed={hintRevealed}
              >
                <Lightbulb data-icon="inline-start" />
                {hintRevealed ? 'Hint on' : 'Hint'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="drill-action-btn"
                onClick={onRestart}
                disabled={!line}
              >
                <RotateCcw data-icon="inline-start" />
                Restart
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="drill-action-btn"
                disabled={!lineHref}
                onClick={() => {
                  if (!lineHref) return
                  window.open(lineHref, '_blank', 'noopener,noreferrer')
                }}
              >
              Study on Lichess
              <ExternalLink data-icon="inline-end" />
              </Button>
            </div>

            {line ? (
              <p className="drill-line-summary">
                {lineIndex >= 0 ? (
                  <span className="drill-line-eco">
                    #{lineIndex + 1} · {familyMeta?.label ?? 'Line'} ·{' '}
                    {line.eco ?? 'C50'} —{' '}
                  </span>
                ) : null}
                {line.summary}
              </p>
            ) : null}
          </div>

          {showHintBubble ? (
            <div
              className={[
                'drill-coach',
                wrongFlash || mistakeMessage ? 'is-wrong' : '',
                status === 'complete' ? 'is-complete' : '',
                hintRevealed && !mistakeMessage && !wrongFlash
                  ? 'is-hint'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="drill-coach-avatar" aria-hidden="true">
                ♘
              </div>
              <div className="drill-coach-bubble">
                {status === 'complete'
                  ? 'Line complete — scrub the line or restart.'
                  : mistakeMessage
                    ? mistakeMessage
                    : wrongFlash
                      ? 'Not that one — check the hint and try again.'
                      : hint}
                {mistakeMessage && onTryAgain ? (
                  <div className="drill-try-again">
                    <PixelButton onClick={onTryAgain}>Try again</PixelButton>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {line && status === 'complete' && onScrubPly && (
            <div
              className="drill-scrub"
              role="group"
              aria-label="Drill ply scrub"
            >
              <PixelButton
                ghost
                disabled={plyIndex <= 0}
                onClick={() => onScrubPly(plyIndex - 1)}
                aria-label="Previous ply"
              >
                ‹
              </PixelButton>
              <span className="drill-scrub-label">
                {plyIndex}/{scrubMax}
              </span>
              <PixelButton
                ghost
                disabled={plyIndex >= scrubMax}
                onClick={() => onScrubPly(plyIndex + 1)}
                aria-label="Next ply"
              >
                ›
              </PixelButton>
            </div>
          )}

          {showCoach && line && (
            <div className="drill-coach-embed">
              <CoachPane
                explanation={coachExplanation}
                coachStatus={coachStatus}
                coachError={coachError}
                chatMessages={coachChat}
                chatStatus={coachChatStatus}
                chatError={coachChatError}
                onSendChat={onSendCoachChat!}
                isPlayerTurn
                drillMode
                emptyHint=""
              />
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
