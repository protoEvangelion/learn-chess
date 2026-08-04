import type { FC, ReactNode } from 'react'
import { useRef } from 'react'
import type { Position } from '@logic/board'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'

export const PieceMaterial: FC<{
  color: string
  isSelected: boolean
  pieceIsBeingReplaced: boolean
  variant?: 'metal' | 'wood'
}> = ({ color, isSelected, pieceIsBeingReplaced, variant = 'metal' }) => {
  const isWhite = color === 'white'
  const transparent = pieceIsBeingReplaced
  if (variant === 'wood') {
    return (
      <meshStandardMaterial
        color={isWhite ? '#f0e6d4' : '#3a2a1c'}
        emissive={isSelected ? '#733535' : '#000000'}
        roughness={0.55}
        metalness={0.08}
        attach="material"
        opacity={pieceIsBeingReplaced ? 0 : 1}
        transparent={transparent}
      />
    )
  }
  return (
    <meshStandardMaterial
      color={isWhite ? '#d9d9d9' : '#7c7c7c'}
      emissive={isSelected ? '#733535' : '#000000'}
      metalness={0.85}
      roughness={0.45}
      attach="material"
      envMapIntensity={0.35}
      opacity={pieceIsBeingReplaced ? 0 : 1}
      transparent={transparent}
    />
  )
}

export type ModelProps = {
  position?: [number, number, number]
  scale?: [number, number, number]
  meshScale?: number
  materialVariant?: 'metal' | 'wood' | 'textured'
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

const SELECT_LIFT = 0.35
const LIFT = 0.55

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
  fromScale: number
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
  scale = [0.15, 0.15, 0.15],
  meshScale = 0.03,
  materialVariant = 'metal',
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
  const settled = useRef(false)

  const tile = 1 / scale[0]
  const dist = (n: number) => n * tile

  useFrame((_, delta) => {
    const mesh = pieceRef.current
    if (!mesh) return

    const busy =
      !!movingToRef.current ||
      replacingRef.current ||
      !!captureAnim.current ||
      !!moveAnim.current ||
      selectedRef.current ||
      !settled.current

    if (!busy) return

    if (replacingRef.current && !wasReplacing.current) {
      wasReplacing.current = true
      settled.current = false
      captureAnim.current = {
        start: performance.now(),
        duration: 280,
        fromScale: 1,
      }
    } else if (!replacingRef.current && wasReplacing.current) {
      wasReplacing.current = false
      captureAnim.current = null
      mesh.scale.set(1, 1, 1)
      mesh.rotation.set(0, 0, 0)
    }

    const capture = captureAnim.current
    if (capture) {
      const t = Math.min(
        1,
        (performance.now() - capture.start) / capture.duration,
      )
      const e = easeInOutCubic(t)
      const s = capture.fromScale * (1 - e)
      mesh.scale.setScalar(Math.max(0.01, s))
      mesh.position.y = e * 0.8
      mesh.rotation.y = e * 4
      mesh.rotation.x = e * 1.2
      return
    }

    const target = movingToRef.current
    if (!target) {
      moveAnim.current = null
    } else if (!moveAnim.current) {
      settled.current = false
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
        anim.fromY + (0 - anim.fromY) * e + Math.sin(Math.PI * e) * LIFT * tile

      if (t >= 1) {
        anim.done = true
        mesh.position.set(anim.toX, 0, anim.toZ)
        finishRef.current()
      }
      return
    }

    const targetY = selectedRef.current ? SELECT_LIFT * tile : 0
    const k = 1 - Math.exp(-14 * delta)
    mesh.position.x += (0 - mesh.position.x) * k
    mesh.position.y += (targetY - mesh.position.y) * k
    mesh.position.z += (0 - mesh.position.z) * k

    const dx = Math.abs(mesh.position.x)
    const dy = Math.abs(mesh.position.y - targetY)
    const dz = Math.abs(mesh.position.z)
    if (dx + dy + dz < 0.001) {
      mesh.position.set(0, targetY, 0)
      settled.current = !selectedRef.current
    } else {
      settled.current = false
    }
  })

  return (
    <group
      position={position}
      scale={scale}
      onClick={onClick}
      dispose={null}
      onPointerOver={(e) => {
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto'
      }}
    >
      <group ref={pieceRef}>
        {materialVariant === 'textured' ? (
          <group visible={!pieceIsBeingReplaced}>{children}</group>
        ) : (
          <mesh scale={meshScale} castShadow={!pieceIsBeingReplaced}>
            {children}
            <PieceMaterial
              color={color}
              pieceIsBeingReplaced={pieceIsBeingReplaced}
              isSelected={isSelected}
              variant={materialVariant === 'wood' ? 'wood' : 'metal'}
            />
          </mesh>
        )}
      </group>
    </group>
  )
}
