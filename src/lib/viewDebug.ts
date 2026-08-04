import type { Vec3 } from '@/lib/themes'

export type LiveViewSnapshot = {
  roomId: string
  boardId: string
  pieceSetId: string
  boardOffset: Vec3
  cameraPosition: Vec3
  cameraTarget: Vec3
  cameraFov: number
  distance: number
  polarAngle: number
  azimuthAngle: number
  minDistance: number
  maxDistance: number
  minPolarAngle: number
  maxPolarAngle: number
}

let latest: LiveViewSnapshot | null = null

export function setLiveView(snapshot: LiveViewSnapshot) {
  latest = snapshot
}

export function getLiveView() {
  return latest
}

/** Paste-ready block for themes.ts room entry. */
export function formatViewForThemes(s: LiveViewSnapshot): string {
  const v = (n: number) => +n.toFixed(3)
  const vec = ([x, y, z]: Vec3) => `[${v(x)}, ${v(y)}, ${v(z)}]`
  return [
    `// Live view dump (${s.roomId} / ${s.boardId} / ${s.pieceSetId})`,
    `boardOffset: ${vec(s.boardOffset)},`,
    `cameraPosition: ${vec(s.cameraPosition)},`,
    `cameraFov: ${v(s.cameraFov)},`,
    `minDistance: ${v(s.minDistance)},`,
    `maxDistance: ${v(s.maxDistance)},`,
    `minPolarAngle: ${v(s.minPolarAngle)}, // tilt limit (from top)`,
    `maxPolarAngle: ${v(s.maxPolarAngle)}, // tilt limit (from top)`,
    `// live orbit: distance=${v(s.distance)} polar=${v(s.polarAngle)} az=${v(s.azimuthAngle)}`,
    `// cameraTarget (usually = boardOffset): ${vec(s.cameraTarget)}`,
  ].join('\n')
}
