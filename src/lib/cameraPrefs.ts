import type { Vec3 } from '@/lib/themes'

const KEY = 'chess-3d:defaultCamera'

export type DefaultCameraAngle = {
  position: Vec3
  target: Vec3
}

type Store = Record<string, DefaultCameraAngle>

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Store
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store: Store) {
  localStorage.setItem(KEY, JSON.stringify(store))
}

export function loadDefaultCamera(roomId: string): DefaultCameraAngle | null {
  const entry = readStore()[roomId]
  if (!entry?.position || !entry?.target) return null
  if (entry.position.length !== 3 || entry.target.length !== 3) return null
  return {
    position: [...entry.position] as Vec3,
    target: [...entry.target] as Vec3,
  }
}

export function saveDefaultCamera(
  roomId: string,
  position: Vec3,
  target: Vec3,
) {
  const store = readStore()
  store[roomId] = {
    position: [...position] as Vec3,
    target: [...target] as Vec3,
  }
  writeStore(store)
}

export function clearDefaultCamera(roomId: string) {
  const store = readStore()
  delete store[roomId]
  writeStore(store)
}

export function hasDefaultCamera(roomId: string) {
  return loadDefaultCamera(roomId) != null
}
