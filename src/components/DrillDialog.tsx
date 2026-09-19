import { type FC } from 'react'
import { PixelButton } from '@/components/ui/PixelButton'
import { PanelResizeHandle } from '@/components/PanelResizeHandle'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ITALIAN_LINES } from '@/lib/drills/italian'
import type { DrillLine, DrillProgress } from '@/lib/drills/types'
import { drillStats } from '@/lib/drills/progress'

type Props = {
  open: boolean
  onClose: () => void
  line: DrillLine | null
  plyIndex: number
  hint: string
  wrongFlash?: boolean
  progress: DrillProgress
  onSelectLine: (lineId: string) => void
  onRestart: () => void
  onShowHint: () => void
  hintRevealed: boolean
  tipSquares: string | null
  status: 'idle' | 'playing' | 'complete'
  onScrubPly?: (index: number) => void
  scrubMax?: number
  panelWidth: number
  onPanelWidthChange: (width: number) => void
  onPanelResizeEnd?: (width: number) => void
}

export const DrillDialog: FC<Props> = ({
  open,
  onClose,
  line,
  plyIndex,
  hint,
  wrongFlash = false,
  progress,
  onSelectLine,
  onRestart,
  onShowHint,
  hintRevealed,
  tipSquares,
  status,
  onScrubPly,
  scrubMax = 0,
  panelWidth,
  onPanelWidthChange,
  onPanelResizeEnd,
}) => {
  const stats = drillStats(progress)
  const moveNo =
    Math.floor(Math.min(plyIndex, Math.max(scrubMax - 1, 0)) / 2) + 1
  const side = plyIndex % 2 === 0 ? 'White' : 'Black'
  const lineIndex = line
    ? ITALIAN_LINES.findIndex((l) => l.id === line.id)
    : -1

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
        <header className="drill-dialog-header">
          <div className="drill-dialog-title">
            <p className="drill-eyebrow">Opening drill</p>
            <h2>Italian Opening</h2>
          </div>
          <PixelButton ghost onClick={onClose}>
            Close
          </PixelButton>
        </header>

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
              <SelectValue placeholder="Pick a line to practice" />
            </SelectTrigger>
            <SelectContent
              position="popper"
              align="start"
              className="drill-line-select-content max-h-72"
            >
              {ITALIAN_LINES.map((l, i) => {
                const done = progress.discovered.includes(l.id)
                const perfect = (progress.perfected[l.id] ?? 0) >= 3
                const flag = perfect ? '★★★' : done ? '★' : ''
                return (
                  <SelectItem key={l.id} value={l.id} textValue={l.name}>
                    <span className="drill-line-select-row">
                      <span className="text-muted-foreground">#{i + 1}</span>
                      <span>{l.name}</span>
                      {flag ? (
                        <span className="text-muted-foreground">{flag}</span>
                      ) : null}
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          {line ? (
            <p className="drill-line-summary">
              {lineIndex >= 0 ? (
                <span className="drill-line-eco">
                  #{lineIndex + 1} · {line.eco ?? 'C50'} —{' '}
                </span>
              ) : null}
              {line.summary}
            </p>
          ) : (
            <p className="drill-status">Pick a line to start practicing.</p>
          )}
        </div>

        <div
          className={[
            'drill-coach',
            wrongFlash ? 'is-wrong' : '',
            status === 'complete' ? 'is-complete' : '',
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
              : wrongFlash
                ? 'Not that one — check the hint and try again.'
                : hint}
          </div>
        </div>

        {line && status === 'playing' && (
          <p className="drill-ply-label">
            Move {moveNo} · {side} to play
            {hintRevealed && tipSquares ? ` · try ${tipSquares}` : ''}
          </p>
        )}

        {line && status === 'complete' && onScrubPly && (
          <div className="drill-scrub" role="group" aria-label="Drill ply scrub">
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

        <footer className="drill-actions">
          <PixelButton
            ghost
            onClick={onShowHint}
            disabled={!line || status === 'complete'}
          >
            Hint
          </PixelButton>
          <PixelButton ghost onClick={onRestart} disabled={!line}>
            Restart
          </PixelButton>
        </footer>
      </aside>
    </div>
  )
}
