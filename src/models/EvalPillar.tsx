import { useMemo, useRef } from 'react'
import type { FC } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'

/**
 * Board group origin = exact board center (0,0,0).
 * Marble Border slab is 9×9 → outer faces at ±4.5.
 * Meter is centered on that origin and spans the full marble edge.
 */
const RIM_X = 4.78
/** Match Border box depth so midpoints + ends line up with the frame. */
const LENGTH = 9
const WIDTH = 0.48
/** Raised enough that the side face reads as a slab, not a sticker. */
const THICK = 0.22
const Y = 0.03
const GAP = 0.025
/** End caps stay inside ±LENGTH/2 so the AABB stays board-centered. */
const CAP = 0.05

type Props = {
  /** 0–100, White's share (near rank → far, chess.com white-at-bottom). */
  whitePercent: number
  /** Short score, e.g. "+0.20", "0.00", "M3". */
  label: string
  /** 0 = White's seat, π = Black's seat. */
  seatYaw: number
}

function lengths(pct: number) {
  const w = Math.max(0.02, (pct / 100) * LENGTH - GAP / 2)
  const b = Math.max(0.02, LENGTH - GAP - w)
  return { w, b }
}

/**
 * Eval meter as a flat 3D slab on the left table edge.
 * White grows from the near rank (+Z) toward −Z; fills never share a plane.
 */
export const EvalPillar: FC<Props> = ({ whitePercent, label, seatYaw }) => {
  const blackSeat = Math.abs(seatYaw) > Math.PI / 2
  const x = blackSeat ? RIM_X : -RIM_X

  const fill = useRef(Math.max(0, Math.min(100, whitePercent)))
  const whiteMesh = useRef<THREE.Mesh>(null)
  const blackMesh = useRef<THREE.Mesh>(null)
  const labelGroup = useRef<THREE.Group>(null)
  const target = Math.max(0, Math.min(100, whitePercent))

  const whiteMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#f3eee4',
        roughness: 0.3,
        metalness: 0.06,
        emissive: '#cfc6b4',
        emissiveIntensity: 0.1,
      }),
    [],
  )
  const blackMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#14121c',
        roughness: 0.45,
        metalness: 0.1,
      }),
    [],
  )
  const frameMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#3d384c',
        roughness: 0.38,
        metalness: 0.18,
      }),
    [],
  )

  useFrame((_, dt) => {
    fill.current += (target - fill.current) * (1 - Math.exp(-10 * dt))
    const { w, b } = lengths(fill.current)
    // Near rank is +Z; white grows from +Z toward −Z.
    if (whiteMesh.current) {
      whiteMesh.current.scale.z = w
      whiteMesh.current.position.z = LENGTH / 2 - w / 2
    }
    if (blackMesh.current) {
      blackMesh.current.scale.z = b
      blackMesh.current.position.z = -LENGTH / 2 + b / 2
    }
    if (labelGroup.current) {
      const majority = fill.current >= 50
      labelGroup.current.position.z = majority
        ? LENGTH / 2 - w * 0.32
        : -LENGTH / 2 + b * 0.32
    }
  })

  const score = label.trim() || '—'
  const majorityWhite = target >= 50
  const { w: w0, b: b0 } = lengths(target)
  const labelZ = majorityWhite
    ? LENGTH / 2 - w0 * 0.32
    : -LENGTH / 2 + b0 * 0.32
  const fillY = Y + THICK / 2 + 0.002

  // Readable from the seat: same orientation as left-rim rank labels.
  const textRot: [number, number, number] = [
    -Math.PI / 2,
    0,
    blackSeat ? Math.PI / 2 : -Math.PI / 2,
  ]

  return (
    // Local (0,0,0) = board center; only X is nudged to the left/right rim.
    <group position={[x, 0, 0]}>
      {/* Frame tray — same LENGTH, centered on board mid-rank */}
      <mesh position={[0, Y, 0]} material={frameMat} castShadow receiveShadow>
        <boxGeometry args={[WIDTH + 0.1, THICK * 0.55, LENGTH]} />
      </mesh>
      {/* End caps inset so they don't shift the visual center */}
      <mesh
        position={[0, fillY * 0.7, LENGTH / 2 - CAP / 2]}
        material={frameMat}
        castShadow
      >
        <boxGeometry args={[WIDTH + 0.06, THICK * 0.9, CAP]} />
      </mesh>
      <mesh
        position={[0, fillY * 0.7, -LENGTH / 2 + CAP / 2]}
        material={frameMat}
        castShadow
      >
        <boxGeometry args={[WIDTH + 0.06, THICK * 0.9, CAP]} />
      </mesh>

      {/* Unit-Z fills — scale.z + position lerped */}
      <mesh
        ref={blackMesh}
        position={[0, fillY, -LENGTH / 2 + b0 / 2]}
        scale={[1, 1, b0]}
        material={blackMat}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[WIDTH, THICK, 1]} />
      </mesh>
      <mesh
        ref={whiteMesh}
        position={[0, fillY, LENGTH / 2 - w0 / 2]}
        scale={[1, 1, w0]}
        material={whiteMat}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[WIDTH, THICK, 1]} />
      </mesh>

      <group ref={labelGroup} position={[0, fillY + THICK / 2 + 0.02, labelZ]}>
        <Text
          rotation={textRot}
          font="/fonts/libre-baskerville-700.woff"
          fontSize={0.28}
          anchorX="center"
          anchorY="middle"
          color={majorityWhite ? '#1a1520' : '#f8fafc'}
          outlineWidth={0.014}
          outlineColor={majorityWhite ? '#f3eee4' : '#0a0810'}
          depthOffset={-2}
        >
          {score}
        </Text>
      </group>
    </group>
  )
}
