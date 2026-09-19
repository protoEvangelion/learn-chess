import { Howl } from 'howler'
import { loadMuted, loadVolume, MUTE_KEY, VOLUME_KEY } from '@/lib/themes'

export type SfxId = 'move' | 'capture' | 'check' | 'gameOver'

const sources: Record<SfxId, string> = {
  move: '/sfx/move.wav',
  capture: '/sfx/capture.wav',
  check: '/sfx/check.wav',
  gameOver: '/sfx/gameOver.wav',
}

let muted = loadMuted()
let volume = loadVolume()
const cache = new Map<SfxId, Howl>()

function getHowl(id: SfxId): Howl {
  let h = cache.get(id)
  if (!h) {
    h = new Howl({ src: [sources[id]], volume, preload: true })
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
  for (const h of cache.values()) h.volume(volume)
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
  h.volume(volume)
  h.play()
}

/** Warm-load clips after first gesture. */
export function unlockSfx() {
  for (const id of Object.keys(sources) as SfxId[]) getHowl(id)
  void import('@/lib/music').then((m) => m.unlockMusic())
}
