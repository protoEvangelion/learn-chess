import type { FC } from 'react'
import { animated, useSpring } from '@react-spring/three'
import type { Position } from '../logic/board'

const getColor = (color: string, canMoveHere: boolean, isTip: boolean) => {
  if (canMoveHere) return `#ff0101`
  if (isTip) return `#3d9b6e`
  if (color === `white`) return `#aaaaaa`
  if (color === `black`) return `#5a5a5a`
  return `purple`
}

const getEmissive = (color: string, canMoveHere: boolean, isTip: boolean) => {
  if (canMoveHere && color === `white`) return `#ff0000`
  if (canMoveHere && color === `black`) return `#c50000`
  if (isTip) return `#1f6b45`
  return `black`
}

export const TileComponent: FC<{
  canMoveHere: Position | null
  color: string
  isTip?: boolean
  position: [number, number, number]
  onClick?: (e: { stopPropagation: () => void }) => void
}> = ({ color, canMoveHere, isTip = false, ...props }) => {
  const { tileColor, emissiveColor } = useSpring({
    tileColor: getColor(color, !!canMoveHere, isTip),
    emissiveColor: getEmissive(color, !!canMoveHere, isTip),
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
