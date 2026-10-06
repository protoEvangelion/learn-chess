import { useEffect, useId, useRef, useState, type FC } from 'react'
import {
  RATING_BANDS,
  type RatingBandId,
} from '@/lib/lichessExplorer'

type Props = {
  value: RatingBandId[]
  onChange: (next: RatingBandId[]) => void
}

/**
 * Local multi-select. src/components/ui/select is single-value only, and
 * shadcn does not ship a multi-select in this app.
 */
export const RatingBandMultiSelect: FC<Props> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const selected = new Set(value)
  const first = RATING_BANDS.find((band) => band.id === value[0])
  const summary =
    value.length === 0
      ? 'Ratings'
      : value.length === 1
        ? (first?.label ?? value[0])
        : `${first?.label ?? value[0]} +${value.length - 1}`

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (id: RatingBandId) => {
    if (selected.has(id)) {
      if (value.length === 1) return
      onChange(value.filter((band) => band !== id))
      return
    }
    onChange([...value, id])
  }

  return (
    <div className="rating-band-multi" ref={rootRef}>
      <button
        type="button"
        className="rating-band-select rating-band-multi-trigger"
        aria-label="Rating bands"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
      >
        {summary}
      </button>
      {open ? (
        <ul id={listId} className="rating-band-multi-list" role="listbox" aria-multiselectable="true">
          {RATING_BANDS.map((band) => {
            const checked = selected.has(band.id)
            return (
              <li key={band.id}>
                <label className="rating-band-multi-option">
                  <input
                    type="checkbox"
                    role="option"
                    aria-selected={checked}
                    checked={checked}
                    onChange={() => toggle(band.id)}
                  />
                  <span>{band.label}</span>
                </label>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
