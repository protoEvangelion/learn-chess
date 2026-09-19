import {
  useEffect,
  useState,
  type CSSProperties,
  type FC,
} from 'react'

type Props = {
  active: boolean
  /** Piece count (default 48). */
  count?: number
}

/** One-shot confetti blast — plays once when `active` becomes true, then clears. */
export const ConfettiBurst: FC<Props> = ({ active, count = 48 }) => {
  const [burstId, setBurstId] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!active) {
      setPlaying(false)
      return
    }
    setBurstId((n) => n + 1)
    setPlaying(true)
    // Longest piece: delay ~0.88s + dur ~4.0s
    const t = window.setTimeout(() => setPlaying(false), 5000)
    return () => window.clearTimeout(t)
  }, [active])

  if (!playing) return null

  return (
    <div className="confetti confetti-burst" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={`${burstId}-${i}`}
          className="confetti-piece is-once"
          style={
            {
              '--x': `${(i * 37) % 100}%`,
              '--delay': `${(i % 12) * 0.08}s`,
              '--dur': `${2.2 + (i % 5) * 0.3}s`,
              '--rot': `${(i * 47) % 360}deg`,
              '--hue': `${(i * 29) % 360}`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
