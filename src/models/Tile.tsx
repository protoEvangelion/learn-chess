import type { FC } from 'react'
import { animated, useSpring } from '@react-spring/three'
import type { Position } from '../logic/board'

const getColor = (color: string, canMoveHere: boolean) => {
  if (canMoveHere) return `#ff0101`
  if (color === `white`) return `#aaaaaa`
  if (color === `black`) return `#5a5a5a`
  return `purple`
}

const getEmissive = (color: string, canMoveHere: boolean) => {
  if (canMoveHere && color === `white`) return `#ff0000`
  if (canMoveHere && color === `black`) return `#c50000`
  return `black`
}

export const TileComponent: FC<{
  canMoveHere: Position | null
  color: string
  position: [number, number, number]
  onClick?: (e: { stopPropagation: () => void }) => void
}> = ({ color, canMoveHere, ...props }) => {
  const { tileColor, emissiveColor } = useSpring({
    tileColor: getColor(color, !!canMoveHere),
    emissiveColor: getEmissive(color, !!canMoveHere),
  })
  return (
    <mesh scale={[1, 0.5, 1]} receiveShadow castShadow {...props}>
      <boxGeometry />
      <animated.meshPhysicalMaterial
        reflectivity={3}
        color={tileColor}
        emissive={emissiveColor}
        metalness={0.8}
        roughness={0.7}
        envMapIntensity={0.15}
        attach="material"
      />
    </mesh>
  )
}
