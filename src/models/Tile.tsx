import type { FC, Ref } from 'react'
import { memo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import type { Position } from '../logic/board'

const getColor = (
  color: string,
  canMoveHere: boolean,
  isCheck: boolean,
) => {
  if (canMoveHere) return `#ff0101`
  if (isCheck) return `#e11d2e`
  if (color === `white`) return `#aaaaaa`
  if (color === `black`) return `#5a5a5a`
  return `purple`
}

const getEmissive = (
  color: string,
  canMoveHere: boolean,
  isCheck: boolean,
) => {
  if (canMoveHere && color === `white`) return `#ff0000`
  if (canMoveHere && color === `black`) return `#c50000`
  if (isCheck) return `#b01020`
  return `#000000`
}

function borderBars(y: number, t: number, length: number) {
  return [
    [0, y, 0.5 - t / 2, length, t, t],
    [0, y, -0.5 + t / 2, length, t, t],
    [0.5 - t / 2, y, 0, t, t, length],
    [-0.5 + t / 2, y, 0, t, t, length],
  ] as const
}

const BorderLayer: FC<{
  groupRef?: Ref<Group>
  y: number
  thickness: number
  length: number
  color: string
}> = ({ groupRef, y, thickness, length, color }) => (
  <group ref={groupRef}>
    {borderBars(y, thickness, length).map(([x, yy, z, w, h, d], i) => (
      <mesh key={i} position={[x, yy, z]}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    ))}
  </group>
)

const LastMoveBorder: FC = () => (
  <BorderLayer y={0.27} thickness={0.055} length={1.02} color="#5eb0ff" />
)

/** Lightsaber-style best-move: outer aura + bright core, pulsed via color only. */
const BestMoveBorder: FC = () => {
  const core = useRef<Group>(null)
  const glow = useRef<Group>(null)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 5.5
    const pulse = 0.82 + Math.sin(t) * 0.18
    const aura = 0.5 + Math.sin(t + 0.35) * 0.12
    core.current?.traverse((obj) => {
      const mesh = obj as Mesh
      if (!mesh.isMesh) return
      ;(mesh.material as MeshBasicMaterial).color.setRGB(
        0.35 * pulse,
        1.0 * pulse,
        0.48 * pulse,
      )
    })
    glow.current?.traverse((obj) => {
      const mesh = obj as Mesh
      if (!mesh.isMesh) return
      ;(mesh.material as MeshBasicMaterial).color.setRGB(
        0.04 * aura,
        0.5 * aura,
        0.16 * aura,
      )
    })
  })

  return (
    <group>
      <BorderLayer
        groupRef={glow}
        y={0.265}
        thickness={0.09}
        length={1.08}
        color="#0d6b32"
      />
      <BorderLayer
        groupRef={core}
        y={0.288}
        thickness={0.038}
        length={1.0}
        color="#7dff9c"
      />
    </group>
  )
}

export const TileComponent: FC<{
  canMoveHere: Position | null
  color: string
  isTip?: boolean
  isCheck?: boolean
  isLastMove?: boolean
  mode?: 'solid' | 'hit'
  position: [number, number, number]
  onClick?: (e: { stopPropagation: () => void }) => void
}> = memo(function TileComponent({
  color,
  canMoveHere,
  isTip = false,
  isCheck = false,
  isLastMove = false,
  mode = 'solid',
  position,
  onClick,
}) {
  const tileColor = getColor(color, !!canMoveHere, isCheck)
  const emissiveColor = getEmissive(color, !!canMoveHere, isCheck)
  const showHighlight = !!canMoveHere || isCheck

  if (mode === 'hit') {
    return (
      <group position={position} onClick={onClick}>
        <mesh scale={[1, 0.2, 1]} position={[0, 0.15, 0]}>
          <boxGeometry />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        {showHighlight && (
          <mesh position={[0, 0.28, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.92, 0.92]} />
            <meshBasicMaterial
              color={tileColor}
              transparent
              opacity={0.45}
              depthWrite={false}
            />
          </mesh>
        )}
        {isLastMove && <LastMoveBorder />}
        {isTip && <BestMoveBorder />}
      </group>
    )
  }

  return (
    <group position={position} onClick={onClick}>
      <mesh scale={[1, 0.5, 1]} receiveShadow>
        <boxGeometry />
        <meshStandardMaterial
          color={tileColor}
          emissive={emissiveColor}
          emissiveIntensity={showHighlight ? 0.6 : 0}
          metalness={0.35}
          roughness={0.75}
          envMapIntensity={0.1}
        />
      </mesh>
      {isLastMove && <LastMoveBorder />}
      {isTip && <BestMoveBorder />}
    </group>
  )
})
