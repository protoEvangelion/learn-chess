import { type FC } from 'react'
import { AnimatePresence } from 'motion/react'
import { ChevronRight, ExternalLink, Eye, Lightbulb, RotateCcw, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PixelButton } from '@/components/ui/PixelButton'
import { HaloPolishedNotification } from '@/components/ui/halo-notification'
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
import { drillOpenings, italianLinesByFamily } from '@/lib/drills/italian'
import { drillLineSourceUrl, noteForPly } from '@/lib/drills/engine'
import type { DrillLine, DrillOpeningId, DrillProgress } from '@/lib/drills/types'
import {
  DRILL_FAMILIES,
  DRILL_OPENING_TITLES,
  drillOpeningId,
  drillPlyPreview,
} from '@/lib/drills/types'
import { drillStats } from '@/lib/drills/progress'
import { formatStepStats, useDrillStepStats } from '@/lib/drills/useStepStats'

type Props = {
  open: boolean
  onClose: () => void
  line: DrillLine | null
  plyIndex: number
  hint: string
  /** Position on the board. Stats are for the book move about to be played. */
  fen: string
  /** False while the board is between plies, so we keep the previous numbers. */
  stepAligned: boolean
  wrongFlash?: boolean
  mistakeMessage?: string | null
  onTryAgain?: () => void
  progress: DrillProgress
  /** Opening pack shown in the heading and used to filter the line list. */
  openingId: DrillOpeningId
  onSelectOpening: (openingId: DrillOpeningId) => void
  onSelectLine: (lineId: string) => void
  onRestart: () => void
  onShowHint: () => void
  hintRevealed: boolean
  status: 'idle' | 'playing' | 'complete'
  /** Clean clear (no wrong moves) — triggers confetti. */
  celebrate?: boolean
  onScrubPly?: (index: number) => void
  /** Current scrub cursor (may differ from plyIndex while a wrong move is on the board). */
  scrubPly?: number
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
  /** Idea/danger preview is playing on the board. */
  previewActive?: boolean
  /** Preview still animating moves. */
  previewBusy?: boolean
  onStartPreview?: () => void
  onExitPreview?: () => void
}

export const DrillDialog: FC<Props> = ({
  open,
  onClose,
  line,
  plyIndex,
  hint,
  fen,
  stepAligned,
  wrongFlash = false,
  mistakeMessage = null,
  onTryAgain,
  progress,
  openingId,
  onSelectOpening,
  onSelectLine,
  onRestart,
  onShowHint,
  hintRevealed,
  status,
  celebrate = false,
  onScrubPly,
  scrubPly,
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
  previewActive = false,
  previewBusy = false,
  onStartPreview,
  onExitPreview,
}) => {
  const stats = drillStats(progress)
  const openings = drillOpenings()
  const openingTitle = DRILL_OPENING_TITLES[openingId]
  const allGroups = italianLinesByFamily()
  const lineGroups = allGroups
    .map((group) => ({
      ...group,
      lines: group.lines.filter((l) => drillOpeningId(l) === openingId),
    }))
    .filter((group) => group.lines.length > 0)
  const lineMatches = line ? drillOpeningId(line) === openingId : false
  const shownLine = lineMatches ? line : null
  const openingLines = lineGroups.flatMap((group) => group.lines)
  const lineNumber = shownLine
    ? openingLines.findIndex((l) => l.id === shownLine.id) + 1
    : 0
  const nextLine =
    openingLines.length === 0
      ? null
      : !shownLine
        ? openingLines[0]
        : openingLines[lineNumber % openingLines.length] ?? null
  const positionNote = shownLine ? noteForPly(shownLine, plyIndex) : ''
  const currentPly =
    shownLine && status === 'playing' ? shownLine.moves[plyIndex] : undefined
  const plyAlert = currentPly?.alert
  const ideaHalo =
    currentPly?.revealIdea && shownLine?.summary.trim()
      ? {
          title: 'Core idea',
          description: shownLine.summary.trim(),
          rimVariant: 'default' as const,
        }
      : null
  // Exact-step callouts only (STOP / core idea) — never every ply.
  const halo = plyAlert ?? ideaHalo
  const previewSans = drillPlyPreview(currentPly)
  const canPreview = Boolean(previewSans && onStartPreview && onExitPreview)
  const haloKey = halo
    ? `${shownLine?.id ?? ''}:ply-${plyIndex}:${halo.title}${previewActive ? ':preview' : ''}`
    : null
  const familyMeta = shownLine
    ? DRILL_FAMILIES.find((f) => f.id === shownLine.family)
    : null

  const lineHref = shownLine ? drillLineSourceUrl(shownLine) : null
  const stepSan =
    shownLine && plyIndex < shownLine.moves.length
      ? shownLine.moves[plyIndex].san
      : null
  const stepStats = useDrillStepStats({
    fen,
    san: stepSan,
    enabled: open && Boolean(shownLine) && stepAligned,
  })
  const stepStatsText = formatStepStats(stepStats)

  const showCoach = Boolean(onSendCoachChat) && Boolean(shownLine)
  const showHintBubble =
    Boolean(shownLine) &&
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
            <h2>{openingTitle}</h2>
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
              value={openingId}
              onValueChange={(id) => {
                const next = openings.find((opening) => opening.id === id)
                if (next) onSelectOpening(next.id)
              }}
            >
              <SelectTrigger
                className="drill-line-select w-full"
                size="default"
                aria-label="Opening"
              >
                <SelectValue placeholder="Pick an opening" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                align="start"
                className="drill-line-select-content"
              >
                {openings.map((opening) => (
                  <SelectItem
                    key={opening.id}
                    value={opening.id}
                    textValue={opening.title}
                  >
                    {opening.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={shownLine?.id}
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
                  {shownLine ? (
                    <span className="drill-line-select-row">
                      <span className="drill-line-family-chip">
                        {familyMeta?.label ?? 'Line'}
                      </span>
                      <span>{shownLine.name}</span>
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
                      const lineNo =
                        openingLines.findIndex((x) => x.id === l.id) + 1
                      const done = progress.discovered.includes(l.id)
                      const perfect = (progress.perfected[l.id] ?? 0) >= 3
                      const flag = perfect ? '★★★' : done ? '★' : ''
                      return (
                        <SelectItem key={l.id} value={l.id} textValue={l.name}>
                          <span className="drill-line-select-row">
                            <span className="text-muted-foreground">
                              #{lineNo}
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
                disabled={!shownLine || status === 'complete' || hintRevealed}
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
                disabled={!shownLine}
              >
                <RotateCcw data-icon="inline-start" />
                Restart
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="drill-action-btn"
                onClick={() => {
                  if (nextLine) onSelectLine(nextLine.id)
                }}
                disabled={!nextLine}
                title={nextLine ? nextLine.name : undefined}
              >
                Next line
                <ChevronRight data-icon="inline-end" />
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

            {shownLine ? (
              <p className="drill-line-summary">
                {lineNumber > 0 ? (
                  <span className="drill-line-eco">
                    #{lineNumber} · {openingTitle} —{' '}
                  </span>
                ) : null}
                {positionNote}
              </p>
            ) : null}
            {shownLine && stepStatsText ? (
              <p
                className="drill-step-stats"
                aria-live="polite"
                title="Played is this move's share of games in the opener's current filters. White / Draw / Black is how those games ended. Computer is the stored engine move. The green squares stay the book move."
              >
                {stepStatsText}
              </p>
            ) : null}
          </div>

          <AnimatePresence mode="wait">
            {halo && haloKey ? (
              <HaloPolishedNotification
                key={haloKey}
                className="drill-ply-alert"
                title={previewActive ? `${halo.title} · preview` : halo.title}
                description={
                  previewActive
                    ? previewBusy
                      ? 'Watch the board — then undo to keep drilling the safe move.'
                      : 'That’s the danger. Undo to return and play the book move.'
                    : halo.description
                }
                politeness={plyAlert ? 'alert' : 'status'}
                rimVariant={halo.rimVariant ?? (plyAlert ? 'destructive' : 'default')}
                slideFrom="top"
                action={
                  canPreview ? (
                    <Button
                      type="button"
                      size="xs"
                      variant={previewActive ? 'secondary' : 'outline'}
                      disabled={!previewActive && previewBusy}
                      onClick={previewActive ? onExitPreview : onStartPreview}
                    >
                      {previewActive ? (
                        <>
                          <Undo2 data-icon="inline-start" />
                          Back to drill
                        </>
                      ) : (
                        <>
                          <Eye data-icon="inline-start" />
                          Preview
                        </>
                      )}
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
          </AnimatePresence>

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

          {shownLine &&
          (status === 'playing' || status === 'complete') &&
          onScrubPly ? (
            <div
              className="drill-scrub"
              role="group"
              aria-label="Drill ply scrub"
            >
              <PixelButton
                ghost
                disabled={(scrubPly ?? plyIndex) <= 0 || previewActive}
                onClick={() => onScrubPly((scrubPly ?? plyIndex) - 1)}
                aria-label="Previous ply"
              >
                ‹
              </PixelButton>
              <span className="drill-scrub-label">
                {scrubPly ?? plyIndex}/{scrubMax}
              </span>
              <PixelButton
                ghost
                disabled={(scrubPly ?? plyIndex) >= scrubMax || previewActive}
                onClick={() => onScrubPly((scrubPly ?? plyIndex) + 1)}
                aria-label="Next ply"
              >
                ›
              </PixelButton>
            </div>
          ) : null}

          {showCoach && shownLine ? (
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
          ) : null}
        </div>
      </aside>
    </div>
  )
}
