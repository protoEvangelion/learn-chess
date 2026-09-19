import { useLayoutEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { loadDefaultCamera } from '@/lib/cameraPrefs'

type OrbitLike = {
  target: THREE.Vector3
  update: () => void
  minDistance?: number
  maxDistance?: number
}

type Baseline = {
  position: THREE.Vector3
  target: THREE.Vector3
}

const BOARD_HALF = 4.2

function boardCorners(origin: THREE.Vector3): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (const x of [-BOARD_HALF, BOARD_HALF]) {
    for (const z of [-BOARD_HALF, BOARD_HALF]) {
      pts.push(new THREE.Vector3(origin.x + x, origin.y, origin.z + z))
      pts.push(new THREE.Vector3(origin.x + x, origin.y + 1.2, origin.z + z))
    }
  }
  return pts
}

function projectBounds(
  cam: THREE.Camera,
  points: THREE.Vector3[],
  width: number,
  height: number,
) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const v = new THREE.Vector3()
  for (const p of points) {
    v.copy(p).project(cam)
    const sx = (v.x * 0.5 + 0.5) * width
    const sy = (-v.y * 0.5 + 0.5) * height
    minX = Math.min(minX, sx)
    maxX = Math.max(maxX, sx)
    minY = Math.min(minY, sy)
    maxY = Math.max(maxY, sy)
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    midX: (minX + maxX) / 2,
    midY: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  }
}

/**
 * Refit the orbit camera so the board fills the free strip beside a right
 * drawer (pan to center, dolly in/out to fit). Uses the saved default angle
 * for this room when present; otherwise keeps the pre-panel viewing angle.
 * Restores the pre-panel view when the drawer closes.
 */
export function PanelViewFit({
  active,
  panelWidth,
  fitEpoch,
  boardOrigin,
  sceneKey,
  roomId,
}: {
  active: boolean
  panelWidth: number
  fitEpoch: number
  boardOrigin: [number, number, number]
  /** Room / board / pieces — clears baseline so fit restarts from the new framing. */
  sceneKey: string
  roomId: string
}) {
  const { camera, controls, size, invalidate, gl } = useThree()
  const baseline = useRef<Baseline | null>(null)
  const lastSceneKey = useRef(sceneKey)

  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    const orbit = controls as OrbitLike | null
    if (!cam?.isPerspectiveCamera) return

    cam.clearViewOffset()
    cam.zoom = 1

    const fullW = Math.max(1, size.width)
    const fullH = Math.max(1, size.height)

    if (lastSceneKey.current !== sceneKey) {
      lastSceneKey.current = sceneKey
      baseline.current = null
    }

    if (!active || panelWidth <= 0) {
      if (baseline.current && orbit) {
        cam.position.copy(baseline.current.position)
        orbit.target.copy(baseline.current.target)
        orbit.update()
      }
      baseline.current = null
      cam.updateProjectionMatrix()
      invalidate()
      ;(window as unknown as { __boardFit?: unknown }).__boardFit = {
        active: false,
        ok: true,
      }
      return
    }

    if (!orbit?.target) {
      const t = window.setTimeout(() => invalidate(), 48)
      return () => window.clearTimeout(t)
    }

    if (!baseline.current) {
      baseline.current = {
        position: cam.position.clone(),
        target: orbit.target.clone(),
      }
    }

    const pw = Math.min(Math.max(0, panelWidth), fullW * 0.72)
    const margin = 36
    const freeLeft = margin
    const freeRight = fullW - pw - margin
    const freeMidX = (freeLeft + freeRight) / 2
    const freeMidY = fullH * 0.52
    const freeAvailW = Math.max(80, freeRight - freeLeft)
    const freeAvailH = Math.max(80, fullH - margin * 2)

    const origin = new THREE.Vector3(...boardOrigin)
    const corners = boardCorners(origin)
    const base = baseline.current

    const pref = loadDefaultCamera(roomId)
    const anglePos = pref
      ? new THREE.Vector3(...pref.position)
      : base.position
    const angleTarget = pref
      ? new THREE.Vector3(...pref.target)
      : base.target

    orbit.target.copy(angleTarget)
    let offset = anglePos.clone().sub(angleTarget)
    if (offset.lengthSq() < 1e-8) {
      offset = base.position.clone().sub(base.target)
    }

    const minD = orbit.minDistance ?? 2
    const maxD = orbit.maxDistance ?? 80
    offset.setLength(
      THREE.MathUtils.clamp(offset.length(), minD, maxD),
    )

    for (let i = 0; i < 18; i++) {
      cam.position.copy(orbit.target).add(offset)
      cam.lookAt(orbit.target)
      cam.updateProjectionMatrix()
      cam.updateMatrixWorld(true)

      const b = projectBounds(cam, corners, fullW, fullH)
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion)
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion)
      const dist = Math.max(offset.length(), 0.01)
      const vFov = (cam.fov * Math.PI) / 180
      const worldH = 2 * Math.tan(vFov / 2) * dist
      const worldW = worldH * (fullW / fullH)

      const dxPx = freeMidX - b.midX
      const dyPx = freeMidY - b.midY
      if (Math.abs(dxPx) >= 0.5) {
        orbit.target.addScaledVector(right, -(dxPx / fullW) * worldW)
      }
      if (Math.abs(dyPx) >= 0.5) {
        orbit.target.addScaledVector(up, (dyPx / fullH) * worldH)
      }

      cam.position.copy(orbit.target).add(offset)
      cam.updateMatrixWorld(true)
      const b2 = projectBounds(cam, corners, fullW, fullH)

      const targetW = freeAvailW * 0.92
      const targetH = freeAvailH * 0.9
      const scaleW = b2.w / targetW
      const scaleH = b2.h / targetH
      const scale = Math.max(scaleW, scaleH)

      let adjusted = Math.abs(dxPx) >= 0.5 || Math.abs(dyPx) >= 0.5
      if (scale > 1.02 || scale < 0.96) {
        offset.multiplyScalar(THREE.MathUtils.clamp(scale, 0.72, 1.55))
        offset.setLength(THREE.MathUtils.clamp(offset.length(), minD, maxD))
        adjusted = true
      }

      if (!adjusted) break
    }

    cam.position.copy(orbit.target).add(offset)
    cam.lookAt(orbit.target)
    cam.updateProjectionMatrix()
    orbit.update()
    invalidate()

    cam.updateMatrixWorld(true)
    const final = projectBounds(cam, corners, fullW, fullH)
    const ok =
      final.minX >= freeLeft - 12 &&
      final.maxX <= freeRight + 12 &&
      Math.abs(final.midX - freeMidX) < 48
    ;(window as unknown as { __boardFit?: unknown }).__boardFit = {
      active: true,
      panelWidth: pw,
      freeLeft,
      freeRight,
      freeMidX,
      board: final,
      ok,
      midErr: final.midX - freeMidX,
      canvas: {
        cssW: fullW,
        cssH: fullH,
        bufW: gl.domElement.width,
        bufH: gl.domElement.height,
      },
    }
  }, [
    active,
    panelWidth,
    fitEpoch,
    boardOrigin,
    sceneKey,
    roomId,
    camera,
    controls,
    size.width,
    size.height,
    invalidate,
    gl,
  ])

  return null
}
