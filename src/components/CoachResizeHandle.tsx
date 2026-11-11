import { useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { clampReviewCoachFraction } from '@/lib/coachHeight'

type Props = {
  fraction: number
  containerRef: React.RefObject<HTMLDivElement | null>
  onFractionChange: (fraction: number) => void
  onCommit?: (fraction: number) => void
}

/** Horizontal split handle above a coach chat dock. */
export const CoachResizeHandle = ({
  fraction,
  containerRef,
  onFractionChange,
  onCommit,
}: Props) => {
  const dragging = useRef(false)
  const startY = useRef(0)
  const startFraction = useRef(fraction)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true
    startY.current = event.clientY
    startFraction.current = fraction
    document.body.classList.add('is-review-coach-resizing')
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    event.preventDefault()
    const height = containerRef.current?.getBoundingClientRect().height ?? 0
    if (height <= 0) return
    const delta = startY.current - event.clientY
    onFractionChange(
      clampReviewCoachFraction(startFraction.current + delta / height),
    )
  }

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    document.body.classList.remove('is-review-coach-resizing')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onCommit?.(fraction)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const delta = event.key === 'ArrowUp' ? 0.05 : -0.05
    const next = clampReviewCoachFraction(fraction + delta)
    onFractionChange(next)
    onCommit?.(next)
  }

  return (
    <div
      className="coach-resize-handle"
      role="separator"
      tabIndex={0}
      aria-label="Resize coach area"
      aria-orientation="horizontal"
      aria-valuemin={28}
      aria-valuemax={80}
      aria-valuenow={Math.round(fraction * 100)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
      onKeyDown={onKeyDown}
    >
      <span className="coach-resize-thumb" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  )
}
