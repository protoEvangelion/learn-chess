import { Howl } from 'howler'
import { loadMuted, loadVolume, MUTE_KEY, VOLUME_KEY } from '@/lib/themes'

export type SfxId = 'move' | 'capture' | 'check' | 'gameOver'

const sources: Record<SfxId, string> = {
  move: '/sfx/move.wav?v=2',
  capture: '/sfx/capture.wav?v=2',
  check: '/sfx/check.wav?v=2',
  gameOver: '/sfx/gameOver.wav?v=2',
}

/** Relative levels — keep board feedback soft like chess.com. */
const gain: Record<SfxId, number> = {
  move: 0.55,
  capture: 0.65,
  check: 0.6,
  gameOver: 0.5,
}

let muted = loadMuted()
let volume = loadVolume()
const cache = new Map<SfxId, Howl>()

function mixVolume(id: SfxId) {
  return volume * gain[id]
}

function getHowl(id: SfxId): Howl {
  let h = cache.get(id)
  if (!h) {
    h = new Howl({ src: [sources[id]], volume: mixVolume(id), preload: true })
    cache.set(id, h)
  }
  return h
}

export function setMuted(next: boolean) {
  muted = next
  localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  void import('@/lib/music').then((m) => m.syncMusicFromSfx())
}

export function setVolume(next: number) {
  volume = Math.min(1, Math.max(0, next))
  localStorage.setItem(VOLUME_KEY, String(volume))
  for (const [id, h] of cache) h.volume(mixVolume(id))
  void import('@/lib/music').then((m) => m.syncMusicFromSfx())
}

export function getMuted() {
  return muted
}

export function getVolume() {
  return volume
}

export function playSfx(id: SfxId) {
  if (muted) return
  const h = getHowl(id)
  h.volume(mixVolume(id))
  h.play()
}

/** Warm-load clips after first gesture. */
export function unlockSfx() {
  for (const id of Object.keys(sources) as SfxId[]) getHowl(id)
  void import('@/lib/music').then((m) => m.unlockMusic())
}
