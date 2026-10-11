import type { FC, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ExplorerDateRange } from '@/components/ExplorerDateRange'
import {
  EXPLORER_SPEED_LABELS,
  EXPLORER_SPEEDS,
  RATING_BANDS,
  type ExplorerMonth,
  type ExplorerSpeed,
  type RatingBandId,
} from '@/lib/lichessExplorer'
import { cn } from '@/lib/utils'

type Props = {
  ratings: RatingBandId[]
  speeds: ExplorerSpeed[]
  /** Months present in the database, earliest first. */
  availableMonths: readonly ExplorerMonth[]
  rangeFrom: Date | null
  rangeTo: Date | null
  onRatingsChange: (next: RatingBandId[]) => void
  onSpeedsChange: (next: ExplorerSpeed[]) => void
  onRangeChange: (from: Date, to: Date) => void
}

/**
 * Chip filters for the explorer. shadcn Toggle Group is not installed, and
 * the local Select is single-value, so this stays a local control on Button.
 */
export const ExplorerFilters: FC<Props> = ({
  ratings,
  speeds,
  availableMonths,
  rangeFrom,
  rangeTo,
  onRatingsChange,
  onSpeedsChange,
  onRangeChange,
}) => {
  const ratingSet = new Set(ratings)
  const speedSet = new Set(speeds)

  const toggleRating = (id: RatingBandId) => {
    if (ratingSet.has(id)) {
      if (ratings.length === 1) return
      onRatingsChange(ratings.filter((band) => band !== id))
      return
    }
    onRatingsChange(RATING_BANDS.map((band) => band.id).filter((band) => ratingSet.has(band) || band === id))
  }

  const toggleSpeed = (id: ExplorerSpeed) => {
    if (speedSet.has(id)) {
      if (speeds.length === 1) return
      onSpeedsChange(speeds.filter((speed) => speed !== id))
      return
    }
    onSpeedsChange(EXPLORER_SPEEDS.filter((speed) => speedSet.has(speed) || speed === id))
  }

  return (
    <div className="flex flex-col gap-1.5" aria-label="Explorer filters">
      <ChipRow label="When">
        <ExplorerDateRange
          months={availableMonths}
          from={rangeFrom}
          to={rangeTo}
          onChange={onRangeChange}
        />
      </ChipRow>
      <ChipRow label="Game">
        {EXPLORER_SPEEDS.map((speed) => (
          <FilterChip
            key={speed}
            label={EXPLORER_SPEED_LABELS[speed]}
            pressed={speedSet.has(speed)}
            onClick={() => toggleSpeed(speed)}
          />
        ))}
      </ChipRow>
      <ChipRow label="Rating">
        {RATING_BANDS.map((band) => (
          <FilterChip
            key={band.id}
            label={band.label}
            pressed={ratingSet.has(band.id)}
            onClick={() => toggleRating(band.id)}
          />
        ))}
      </ChipRow>
    </div>
  )
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-12 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

function FilterChip({
  label,
  pressed,
  onClick,
}: {
  label: string
  pressed: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant={pressed ? 'secondary' : 'outline'}
      aria-pressed={pressed}
      className={cn('h-6 rounded-full px-2 text-[11px]', !pressed && 'opacity-60')}
      onClick={onClick}
    >
      {label}
    </Button>
  )
}
