import type { FC } from 'react'
import { animated, useSpring } from '@react-spring/three'
import type { Position } from '../logic/board'

const getColor = (
  color: string,
  canMoveHere: boolean,
  isTip: boolean,
  isCheck: boolean,
) => {
  if (canMoveHere) return `#ff0101`
  if (isCheck) return `#e11d2e`
  if (isTip) return `#3d9b6e`
  if (color === `white`) return `#aaaaaa`
  if (color === `black`) return `#5a5a5a`
  return `purple`
}

const getEmissive = (
  color: string,
  canMoveHere: boolean,
  isTip: boolean,
  isCheck: boolean,
) => {
  if (canMoveHere && color === `white`) return `#ff0000`
  if (canMoveHere && color === `black`) return `#c50000`
  if (isCheck) return `#b01020`
  if (isTip) return `#1f6b45`
  return `black`
}

const LastMoveBorder: FC = () => {
  const y = 0.27
  const t = 0.055
  const len = 1.02
  const bars: [number, number, number, number, number, number][] = [
    // x, y, z, w, h, d
    [0, y, 0.5 - t / 2, len, t, t],
    [0, y, -0.5 + t / 2, len, t, t],
    [0.5 - t / 2, y, 0, t, t, len],
    [-0.5 + t / 2, y, 0, t, t, len],
  ]
  return (
    <group>
      {bars.map(([x, yy, z, w, h, d], i) => (
        <mesh key={i} position={[x, yy, z]}>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial
            color="#5eb0ff"
            emissive="#2a7dff"
            emissiveIntensity={2.4}
            toneMapped={false}
            metalness={0.2}
            roughness={0.35}
          />
        </mesh>
      ))}
    </group>
  )
}

export const TileComponent: FC<{
  canMoveHere: Position | null
  color: string
  isTip?: boolean
  isCheck?: boolean
  isLastMove?: boolean
  position: [number, number, number]
  onClick?: (e: { stopPropagation: () => void }) => void
}> = ({
  color,
  canMoveHere,
  isTip = false,
  isCheck = false,
  isLastMove = false,
  position,
  onClick,
}) => {
  const { tileColor, emissiveColor } = useSpring({
    tileColor: getColor(color, !!canMoveHere, isTip, isCheck),
    emissiveColor: getEmissive(color, !!canMoveHere, isTip, isCheck),
  })
  return (
    <group position={position} onClick={onClick}>
      <mesh scale={[1, 0.5, 1]} receiveShadow castShadow>
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
      {isLastMove && <LastMoveBorder />}
    </group>
  )
}
