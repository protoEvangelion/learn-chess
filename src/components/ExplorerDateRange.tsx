import { useState, type FC } from 'react'
import { CalendarIcon } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { explorerMonthLabel, type ExplorerMonth } from '@/lib/lichessExplorer'

type Props = {
  /** Loaded months, earliest first. */
  months: readonly ExplorerMonth[]
  from: Date | null
  to: Date | null
  onChange: (from: Date, to: Date) => void
}

/** First day of `YYYY-MM` in local time. */
export function monthStart(month: string): Date {
  const [year, mm] = month.split('-').map(Number)
  return new Date(year, mm - 1, 1)
}

/** Last day of `YYYY-MM` in local time. */
export function monthEnd(month: string): Date {
  const [year, mm] = month.split('-').map(Number)
  return new Date(year, mm, 0)
}

/** Months whose calendar month overlaps the inclusive day range. */
export function monthsCovered(
  months: readonly ExplorerMonth[],
  from: Date,
  to: Date,
): ExplorerMonth[] {
  const start = from.getFullYear() * 12 + from.getMonth()
  const end = to.getFullYear() * 12 + to.getMonth()
  return months.filter((month) => {
    const [year, mm] = month.split('-').map(Number)
    const index = year * 12 + (mm - 1)
    return index >= Math.min(start, end) && index <= Math.max(start, end)
  })
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

/**
 * Day range over the months the database actually has. shadcn Calendar is the
 * range control. Cult UI has no date-range component.
 */
export const ExplorerDateRange: FC<Props> = ({ months, from, to, onChange }) => {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>(undefined)
  const earliest = months[0]
  const latest = months[months.length - 1]
  const fullFrom = earliest ? monthStart(earliest) : null
  const fullTo = latest ? monthEnd(latest) : null
  const selected = draft ?? (from && to ? { from, to } : undefined)
  const label =
    from && to
      ? `${formatDay(from)} – ${formatDay(to)}`
      : months.length > 0
        ? `${explorerMonthLabel(months[0])} – ${explorerMonthLabel(months[months.length - 1])}`
        : 'All months'

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next && from && to) setDraft({ from, to })
        if (!next) setDraft(undefined)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          className="h-6 rounded-full px-2 text-[11px]"
          disabled={months.length === 0}
          aria-label="Date range"
        >
          <CalendarIcon />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        {fullFrom && fullTo ? (
          <Calendar
            mode="range"
            selected={selected}
            defaultMonth={fullFrom}
            startMonth={fullFrom}
            endMonth={fullTo}
            numberOfMonths={Math.min(2, months.length)}
            disabled={[{ before: fullFrom }, { after: fullTo }]}
            onSelect={(next) => {
              setDraft(next)
              if (next?.from && next.to) onChange(next.from, next.to)
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
