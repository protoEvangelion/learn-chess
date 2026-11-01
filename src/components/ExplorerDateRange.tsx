import { useState, type FC } from 'react'
import { CalendarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

function dayValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function parseDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function clampDay(date: Date, min: Date, max: Date): Date {
  if (date < min) return min
  if (date > max) return max
  return date
}

/**
 * From and To are separate fields. A range calendar made the second click
 * restart the selection, so each end can be changed on its own.
 */
export const ExplorerDateRange: FC<Props> = ({ months, from, to, onChange }) => {
  const [open, setOpen] = useState(false)
  const earliest = months[0]
  const latest = months[months.length - 1]
  const fullFrom = earliest ? monthStart(earliest) : null
  const fullTo = latest ? monthEnd(latest) : null
  const label =
    from && to
      ? `${formatDay(from)} – ${formatDay(to)}`
      : months.length > 0
        ? `${explorerMonthLabel(months[0])} – ${explorerMonthLabel(months[months.length - 1])}`
        : 'All months'

  const commitFrom = (picked: Date) => {
    if (!fullFrom || !fullTo || !to) return
    const start = clampDay(picked, fullFrom, fullTo)
    const end = start > to ? start : to
    onChange(start, end)
  }

  const commitTo = (picked: Date) => {
    if (!fullFrom || !fullTo || !from) return
    const end = clampDay(picked, fullFrom, fullTo)
    const start = end < from ? end : from
    onChange(start, end)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent align="start" className="w-56 gap-3 p-3">
        {fullFrom && fullTo && from && to ? (
          <>
            <DateField
              label="From"
              value={dayValue(from)}
              min={dayValue(fullFrom)}
              max={dayValue(fullTo)}
              onChange={commitFrom}
            />
            <DateField
              label="To"
              value={dayValue(to)}
              min={dayValue(fullFrom)}
              max={dayValue(fullTo)}
              onChange={commitTo}
            />
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: string
  min: string
  max: string
  onChange: (date: Date) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        aria-label={label}
        className="h-8 rounded-md border border-white/15 bg-black/40 px-2 text-xs font-normal normal-case tracking-normal text-foreground [color-scheme:dark]"
        onChange={(event) => {
          const picked = parseDay(event.target.value)
          if (picked) onChange(picked)
        }}
      />
    </label>
  )
}
