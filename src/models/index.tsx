import type { FC, ReactNode } from 'react'
import { useRef } from 'react'
import type { Position } from '@logic/board'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'

export const PieceMaterial: FC<{
  color: string
  isSelected: boolean
  pieceIsBeingReplaced: boolean
}> = ({ color, isSelected, pieceIsBeingReplaced }) => (
  <meshPhysicalMaterial
    reflectivity={4}
    color={color === 'white' ? '#d9d9d9' : '#7c7c7c'}
    emissive={isSelected ? '#733535' : '#000000'}
    metalness={1}
    roughness={0.5}
    attach="material"
    envMapIntensity={0.2}
    opacity={pieceIsBeingReplaced ? 0 : 1}
    transparent
  />
)

export type ModelProps = {
  position?: [number, number, number]
  scale?: [number, number, number]
  color: string
  isSelected: boolean
  canMoveHere: Position | null
  movingTo: Position | null
  finishMovingPiece: () => void
  pieceIsBeingReplaced: boolean
  wasSelected: boolean
  onClick?: (e: { stopPropagation: () => void }) => void
  children?: ReactNode
}

/** Parent group is scaled 0.15; 1 board square = 1 world unit → local offset ≈ 1/0.15 */
const TILE = 1 / 0.15
const dist = (n: number) => n * TILE
const LIFT = 1.35
const SELECT_LIFT = 1.25

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

type MoveAnim = {
  start: number
  duration: number
  fromX: number
  fromY: number
  fromZ: number
  toX: number
  toZ: number
  done: boolean
}

type CaptureAnim = {
  start: number
  duration: number
  fromX: number
  fromY: number
  fromZ: number
  toX: number
  toY: number
  toZ: number
}

export const MeshWrapper: FC<ModelProps> = ({
  movingTo,
  finishMovingPiece,
  isSelected,
  children,
  pieceIsBeingReplaced,
  wasSelected: _wasSelected,
  color,
  onClick,
  position,
  scale,
}) => {
  const pieceRef = useRef<Group>(null)
  const finishRef = useRef(finishMovingPiece)
  finishRef.current = finishMovingPiece

  const movingToRef = useRef(movingTo)
  movingToRef.current = movingTo
  const selectedRef = useRef(isSelected)
  selectedRef.current = isSelected
  const replacingRef = useRef(pieceIsBeingReplaced)
  replacingRef.current = pieceIsBeingReplaced

  const moveAnim = useRef<MoveAnim | null>(null)
  const captureAnim = useRef<CaptureAnim | null>(null)
  const wasReplacing = useRef(false)

  useFrame((_, delta) => {
    const mesh = pieceRef.current
    if (!mesh) return

    // Capture fly-away (once when capture starts)
    if (replacingRef.current && !wasReplacing.current) {
      wasReplacing.current = true
      captureAnim.current = {
        start: performance.now(),
        duration: 520,
        fromX: mesh.position.x,
        fromY: mesh.position.y,
        fromZ: mesh.position.z,
        toX: (Math.random() > 0.5 ? 1 : -1) * (4 + Math.random() * 4),
        toY: 16 + Math.random() * 4,
        toZ: (Math.random() > 0.5 ? 1 : -1) * (6 + Math.random() * 6),
      }
    } else if (!replacingRef.current) {
      wasReplacing.current = false
      captureAnim.current = null
    }

    const capture = captureAnim.current
    if (capture) {
      const t = Math.min(
        1,
        (performance.now() - capture.start) / capture.duration,
      )
      const e = easeInOutCubic(t)
      mesh.position.x = capture.fromX + (capture.toX - capture.fromX) * e
      mesh.position.y = capture.fromY + (capture.toY - capture.fromY) * e
      mesh.position.z = capture.fromZ + (capture.toZ - capture.fromZ) * e
      return
    }

    const target = movingToRef.current
    if (!target) {
      moveAnim.current = null
    } else if (!moveAnim.current) {
      const travel = Math.hypot(target.x, target.y)
      moveAnim.current = {
        start: performance.now(),
        duration: 260 + travel * 95,
        fromX: mesh.position.x,
        fromY: mesh.position.y,
        fromZ: mesh.position.z,
        toX: dist(target.x),
        toZ: dist(target.y),
        done: false,
      }
    }

    const anim = moveAnim.current
    if (anim && !anim.done) {
      const t = Math.min(1, (performance.now() - anim.start) / anim.duration)
      const e = easeInOutCubic(t)
      mesh.position.x = anim.fromX + (anim.toX - anim.fromX) * e
      mesh.position.z = anim.fromZ + (anim.toZ - anim.fromZ) * e
      mesh.position.y =
        anim.fromY + (0 - anim.fromY) * e + Math.sin(Math.PI * e) * LIFT

      if (t >= 1) {
        anim.done = true
        mesh.position.set(anim.toX, 0, anim.toZ)
        finishRef.current()
      }
      return
    }

    // Idle / selected: damp toward rest or select lift
    const targetY = selectedRef.current ? SELECT_LIFT : 0
    const k = 1 - Math.exp(-14 * delta)
    mesh.position.x += (0 - mesh.position.x) * k
    mesh.position.y += (targetY - mesh.position.y) * k
    mesh.position.z += (0 - mesh.position.z) * k
  })

  return (
    <group position={position} scale={scale} onClick={onClick} dispose={null}>
      <group ref={pieceRef}>
        <mesh scale={0.03} castShadow={!pieceIsBeingReplaced} receiveShadow>
          {children}
          <PieceMaterial
            color={color}
            pieceIsBeingReplaced={pieceIsBeingReplaced}
            isSelected={isSelected}
          />
        </mesh>
      </group>
    </group>
  )
}
