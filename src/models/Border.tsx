import type { FC } from 'react'
import { Text } from '@react-three/drei'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const

/** Center of each file/rank square in world space (board group offset applied in App). */
const SQUARE = (i: number) => i - 3.5
/** Midpoint of the marble rim outside the 8×8. */
const RIM = 4.22
const LABEL_Y = -0.098

type EtchedLabelProps = {
  text: string
  position: [number, number, number]
  rotation: [number, number, number]
}

const EtchedLabel: FC<
  EtchedLabelProps & { color: string; outline: string }
> = ({ text, position, rotation, color, outline }) => (
  <Text
    position={position}
    rotation={rotation}
    font="/fonts/libre-baskerville-700.woff"
    fontSize={0.27}
    anchorX="center"
    anchorY="middle"
    letterSpacing={0.08}
    color={color}
    fillOpacity={0.88}
    outlineWidth={0.004}
    outlineColor={outline}
    outlineOpacity={0.25}
    depthOffset={-2}
  >
    {text}
  </Text>
)

/**
 * a–h / 1–8 on the marble border — dark, flat, etched into the stone.
 * Oriented so each edge reads correctly from that side of the board.
 */
export const BoardCoordinates: FC<{ label?: string; outline?: string }> = ({
  label = '#0d0a09',
  outline = '#3a3330',
}) => (
  <group>
    {FILES.map((file, i) => (
      <EtchedLabel
        key={`file-near-${file}`}
        text={file}
        position={[SQUARE(i), LABEL_Y, RIM]}
        rotation={[-Math.PI / 2, 0, 0]}
        color={label}
        outline={outline}
      />
    ))}
    {FILES.map((file, i) => (
      <EtchedLabel
        key={`file-far-${file}`}
        text={file}
        position={[SQUARE(i), LABEL_Y, -RIM]}
        rotation={[-Math.PI / 2, 0, Math.PI]}
        color={label}
        outline={outline}
      />
    ))}
    {RANKS.map((rank, i) => (
      <EtchedLabel
        key={`rank-a-${rank}`}
        text={rank}
        position={[-RIM, LABEL_Y, SQUARE(7 - i)]}
        rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
        color={label}
        outline={outline}
      />
    ))}
    {RANKS.map((rank, i) => (
      <EtchedLabel
        key={`rank-h-${rank}`}
        text={rank}
        position={[RIM, LABEL_Y, SQUARE(7 - i)]}
        rotation={[-Math.PI / 2, 0, Math.PI / 2]}
        color={label}
        outline={outline}
      />
    ))}
  </group>
)

export const Border: FC<{
  color?: string
  emissive?: string
  label?: string
  labelOutline?: string
}> = ({
  color = '#c6c6c6',
  emissive = '#323232',
  label = '#0d0a09',
  labelOutline = '#3a3330',
}) => (
  <group>
    <mesh
      onClick={(e) => e.stopPropagation()}
      receiveShadow
      position={[0, -0.35, 0]}
    >
      <boxGeometry args={[9, 0.5, 9]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        metalness={0.55}
        roughness={0.65}
        envMapIntensity={0.2}
      />
    </mesh>
    <BoardCoordinates label={label} outline={labelOutline} />
  </group>
)
