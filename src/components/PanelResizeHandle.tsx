import { useEffect, useRef, type FC, type PointerEvent as ReactPointerEvent } from 'react'
import {
  clampPanelWidth,
  savePanelWidth,
} from '@/lib/panelWidth'

type Props = {
  width: number
  onWidthChange: (width: number) => void
  onResizeEnd?: (width: number) => void
}

/** Left-edge drag handle for right drawers. */
export const PanelResizeHandle: FC<Props> = ({
  width,
  onWidthChange,
  onResizeEnd,
}) => {
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(width)
  const latest = useRef(width)
  latest.current = width

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return
      const delta = startX.current - e.clientX
      const next = clampPanelWidth(startW.current + delta)
      latest.current = next
      onWidthChange(next)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.classList.remove('is-panel-resizing')
      savePanelWidth(latest.current)
      onResizeEnd?.(latest.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [onWidthChange, onResizeEnd])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = true
    startX.current = e.clientX
    startW.current = latest.current
    document.body.classList.add('is-panel-resizing')
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  return (
    <div
      className="panel-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={280}
      aria-label="Resize panel"
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
