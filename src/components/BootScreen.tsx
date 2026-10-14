import { useEffect, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { BrandMark } from '@/components/BrandMark'

const MIN_MS = 1700
const MAX_MS = 12000
const FADE_MS = 700

function bootLine(item: string): string {
  const name = item.toLowerCase()
  if (name.includes('hdr') || name.includes('room')) return 'LIGHTING THE ROOM'
  if (name.includes('board')) return 'WAXING THE BOARD'
  if (
    name.includes('piece') ||
    /pawn|knight|bishop|rook|queen|king/.test(name)
  ) {
    return 'SETTING THE PIECES'
  }
  return 'WARMING THE TUBE'
}

/** Arcade cabinet splash. Stays up until the 3D files finish, then powers off. */
export function BootScreen() {
  const { active, progress, item } = useProgress()
  const started = useRef(Date.now())
  const [seenLoad, setSeenLoad] = useState(false)
  const [creep, setCreep] = useState(8)
  const [ready, setReady] = useState(false)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (active || progress > 0) setSeenLoad(true)
  }, [active, progress])

  useEffect(() => {
    if (seenLoad) return
    const id = window.setInterval(() => {
      setCreep((n) => (n >= 36 ? n : n + 4))
    }, 160)
    return () => window.clearInterval(id)
  }, [seenLoad])

  useEffect(() => {
    let cancelled = false
    const fonts = document.fonts?.ready ?? Promise.resolve()
    void fonts.then(() => {
      if (cancelled) return
      const tick = () => {
        if (cancelled) return
        const elapsed = Date.now() - started.current
        const assetsDone =
          elapsed >= MAX_MS ||
          (seenLoad && !active && progress >= 100) ||
          (!seenLoad && elapsed > 900)
        if (!assetsDone) {
          window.setTimeout(tick, 80)
          return
        }
        const wait = Math.max(0, MIN_MS - elapsed)
        window.setTimeout(() => {
          if (!cancelled) setReady(true)
        }, wait)
      }
      tick()
    })
    return () => {
      cancelled = true
    }
  }, [active, progress, seenLoad])

  useEffect(() => {
    if (!ready) return
    const id = window.setTimeout(() => setGone(true), FADE_MS)
    return () => window.clearTimeout(id)
  }, [ready])

  if (gone) return null

  const shown = seenLoad ? Math.max(progress, creep) : creep
  const lit = Math.max(1, Math.min(8, Math.round((shown / 100) * 8)))
  const line = ready ? 'GOOD LUCK' : bootLine(item)

  return (
    <div
      className={['boot-screen', ready ? 'is-done' : ''].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
      aria-busy={!ready}
    >
      <div className="boot-vignette" />
      <div className="boot-scan" />
      <div className="boot-card">
        <p className="boot-kicker">CABINET 08</p>
        <BrandMark className="boot-mark" title="Learn Chess" />
        <h1 className="boot-title">
          LEARN
          <br />
          CHESS
        </h1>
        <div className="boot-rank" aria-hidden="true">
          <span className="boot-knight" style={{ ['--step' as string]: lit - 1 }}>
            ♞
          </span>
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className={i < lit ? 'is-lit' : ''} />
          ))}
        </div>
        <p className="boot-files" aria-hidden="true">
          {'abcdefgh'.split('').map((file) => (
            <span key={file}>{file}</span>
          ))}
        </p>
        <p className="boot-status">{line}</p>
        <p className="boot-pct">{Math.round(shown)}%</p>
      </div>
    </div>
  )
}
