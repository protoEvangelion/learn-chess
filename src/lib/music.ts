import { Howl } from 'howler'
import { getMuted, getVolume } from '@/lib/sfx'

export type MusicTrackId =
  | 'off'
  | 'acid-jazz'
  | 'corncob'
  | 'night-docks'
  | 'vibe-ace'
  | 'osaka'
  | 'ambient'

export type MusicTrack = {
  id: MusicTrackId
  name: string
  /** Short genre tag for the selector */
  tag: string
  src: string | null
  credit: string
}

/** Vendored Kevin MacLeod (CC BY 3.0) — incompetech.com */
export const MUSIC_TRACKS: MusicTrack[] = [
  { id: 'off', name: 'Off', tag: '', src: null, credit: '' },
  {
    id: 'acid-jazz',
    name: 'Acid Jazz',
    tag: 'Jazz',
    src: '/music/acid-jazz.mp3',
    credit: 'Kevin MacLeod — AcidJazz',
  },
  {
    id: 'corncob',
    name: 'Corncob',
    tag: 'Swing',
    src: '/music/corncob.mp3',
    credit: 'Kevin MacLeod — Corncob',
  },
  {
    id: 'night-docks',
    name: 'Night on the Docks',
    tag: 'Sax',
    src: '/music/night-docks.mp3',
    credit: 'Kevin MacLeod — Night on the Docks (Sax)',
  },
  {
    id: 'vibe-ace',
    name: 'Vibe Ace',
    tag: 'Lounge',
    src: '/music/vibe-ace.mp3',
    credit: 'Kevin MacLeod — Vibe Ace',
  },
  {
    id: 'osaka',
    name: 'Off to Osaka',
    tag: 'Lounge',
    src: '/music/osaka.mp3',
    credit: 'Kevin MacLeod — Off to Osaka',
  },
  {
    id: 'ambient',
    name: 'Seventh Seal',
    tag: 'Ambient',
    src: '/music/seventh-seal.mp3',
    credit: 'Kevin MacLeod — Seventh Seal',
  },
]

export const MUSIC_KEY = 'chess-3d:musicTrack'

export function loadMusicTrackId(): MusicTrackId {
  const id = localStorage.getItem(MUSIC_KEY)
  return MUSIC_TRACKS.some((t) => t.id === id) ? (id as MusicTrackId) : 'off'
}

export function getMusicTrack(id: MusicTrackId): MusicTrack {
  return MUSIC_TRACKS.find((t) => t.id === id) ?? MUSIC_TRACKS[0]
}

let trackId: MusicTrackId = 'off'
let howl: Howl | null = null
let unlocked = false

function effectiveVolume() {
  return getMuted() ? 0 : getVolume() * 0.55
}

function stopHowl() {
  if (!howl) return
  howl.stop()
  howl.unload()
  howl = null
}

function playCurrent() {
  const track = getMusicTrack(trackId)
  if (!track.src || getMuted()) return
  if (!unlocked) return

  if (!howl) {
    howl = new Howl({
      src: [track.src],
      loop: true,
      html5: true,
      volume: effectiveVolume(),
      preload: true,
    })
  }
  howl.volume(effectiveVolume())
  if (!howl.playing()) howl.play()
}

/** Call after first user gesture (with unlockSfx). */
export function unlockMusic() {
  unlocked = true
  playCurrent()
}

export function setMusicTrack(id: MusicTrackId) {
  if (id === trackId && howl) {
    playCurrent()
    return
  }
  trackId = id
  localStorage.setItem(MUSIC_KEY, id)
  stopHowl()
  playCurrent()
}

export function getMusicTrackId() {
  return trackId
}

/** Keep BGM in sync when mute/volume change. */
export function syncMusicFromSfx() {
  if (!howl) {
    playCurrent()
    return
  }
  const vol = effectiveVolume()
  howl.volume(vol)
  if (getMuted() || trackId === 'off') {
    howl.pause()
  } else if (unlocked && !howl.playing()) {
    howl.play()
  }
}

/** Init from storage without autoplay until unlock. */
export function initMusicFromStorage() {
  trackId = loadMusicTrackId()
}
