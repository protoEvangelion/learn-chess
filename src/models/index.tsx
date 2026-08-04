import type { FC, ReactNode } from 'react'
import { useEffect } from 'react'
import type { Position } from '@logic/board'
import { animated, useSpring } from '@react-spring/three'

export const PieceMaterial: FC<
  JSX.IntrinsicElements['meshPhysicalMaterial'] & {
    isSelected: boolean
    pieceIsBeingReplaced: boolean
  }
> = ({ color, isSelected, pieceIsBeingReplaced, ...props }) => {
  const { opacity } = useSpring({
    opacity: pieceIsBeingReplaced ? 0 : 1,
  })
  return (
    <animated.meshPhysicalMaterial
      reflectivity={4}
      color={color === 'white' ? '#d9d9d9' : '#7c7c7c'}
      emissive={isSelected ? '#733535' : '#000000'}
      metalness={1}
      roughness={0.5}
      attach="material"
      envMapIntensity={0.2}
      opacity={opacity}
      transparent
      {...props}
    />
  )
}

export type ModelProps = JSX.IntrinsicElements['group'] & {
  color: string
  isSelected: boolean
  canMoveHere: Position | null
  movingTo: Position | null
  finishMovingPiece: () => void
  pieceIsBeingReplaced: boolean
  wasSelected: boolean
}

const FRAMER_MULTIPLIER = 6.66
const getDistance = (px?: number) => (px ? px * FRAMER_MULTIPLIER : 0)

export const MeshWrapper: FC<ModelProps & { children?: ReactNode }> = ({
  movingTo,
  finishMovingPiece,
  isSelected,
  children,
  pieceIsBeingReplaced,
  wasSelected: _wasSelected,
  ...props
}) => {
  const { x, y, z } = useSpring({
    to: pieceIsBeingReplaced
      ? {
          x: 5 * (Math.random() > 0.5 ? -1 : 1),
          y: 20,
          z: 10 * (Math.random() > 0.5 ? -1 : 1),
        }
      : movingTo
        ? {
            x: getDistance(movingTo.x),
            y: 1.5,
            z: getDistance(movingTo.y),
          }
        : {
            x: 0,
            y: isSelected ? 1.4 : 0,
            z: 0,
          },
    config: movingTo
      ? { tension: 200, friction: 28 }
      : pieceIsBeingReplaced
        ? { tension: 50, friction: 12 }
        : { tension: 180, friction: 18 },
  })

  useEffect(() => {
    if (!movingTo) return
    const t = window.setTimeout(() => finishMovingPiece(), 420)
    return () => window.clearTimeout(t)
  }, [movingTo, finishMovingPiece])

  return (
    <group {...props} dispose={null} castShadow>
      <animated.mesh
        scale={0.03}
        castShadow={!pieceIsBeingReplaced}
        receiveShadow
        position-x={x}
        position-y={y}
        position-z={z}
      >
        {children}
        <PieceMaterial
          color={props.color}
          pieceIsBeingReplaced={pieceIsBeingReplaced}
          isSelected={isSelected}
        />
      </animated.mesh>
    </group>
  )
}
