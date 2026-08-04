import type { FC, ReactNode } from 'react'
import { useEffect } from 'react'
import type { Position } from '@logic/board'
import { animated, useSpring } from '@react-spring/three'

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

const DIST = 6.66
const dist = (px?: number) => (px ? px * DIST : 0)

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
  const spring = useSpring({
    to: pieceIsBeingReplaced
      ? {
          x: 5 * (Math.random() > 0.5 ? -1 : 1),
          y: 20,
          z: 10 * (Math.random() > 0.5 ? -1 : 1),
        }
      : movingTo
        ? { x: dist(movingTo.x), y: 1.5, z: dist(movingTo.y) }
        : { x: 0, y: isSelected ? 1.4 : 0, z: 0 },
    config: movingTo
      ? { tension: 200, friction: 28 }
      : { tension: 180, friction: 18 },
  })

  useEffect(() => {
    if (!movingTo) return
    const t = window.setTimeout(() => finishMovingPiece(), 420)
    return () => window.clearTimeout(t)
  }, [movingTo, finishMovingPiece])

  return (
    <group position={position} scale={scale} onClick={onClick} dispose={null}>
      <animated.mesh
        scale={0.03}
        castShadow={!pieceIsBeingReplaced}
        receiveShadow
        position-x={spring.x}
        position-y={spring.y}
        position-z={spring.z}
      >
        {children}
        <PieceMaterial
          color={color}
          pieceIsBeingReplaced={pieceIsBeingReplaced}
          isSelected={isSelected}
        />
      </animated.mesh>
    </group>
  )
}
