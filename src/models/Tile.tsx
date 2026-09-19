import type { FC, Ref } from 'react'
import { memo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import type { Position } from '../logic/board'
import type { MovePreview, PieceSafety } from '../logic/movePreview'
import {
  PIECE_SAFETY_COLOR,
  tradeMarkerColor,
  tradeMarkerLabel,
  washColorForPreview,
} from '../logic/movePreview'

const getColor = (
  color: string,
  canMoveHere: boolean,
  isCheck: boolean,
  previewWash: string | null,
) => {
  if (canMoveHere && previewWash) return previewWash
  if (canMoveHere) return `#5eb0ff`
  if (isCheck) return `#e11d2e`
  if (color === `white`) return `#aaaaaa`
  if (color === `black`) return `#5a5a5a`
  return `purple`
}

const getEmissive = (
  color: string,
  canMoveHere: boolean,
  isCheck: boolean,
  previewWash: string | null,
) => {
  if (canMoveHere && previewWash) {
    return color === `black` ? previewWash : previewWash
  }
  if (canMoveHere && color === `white`) return `#3a8fd4`
  if (canMoveHere && color === `black`) return `#2a6fa8`
  if (isCheck) return `#b01020`
  return `#000000`
}

/** Thin square frame; side bars stop short so corners don’t form cube “blobs”. */
function borderBars(y: number, t: number, outer = 1) {
  const half = outer / 2
  const sideLen = Math.max(outer - 2 * t, t)
  return [
    [0, y, half - t / 2, outer, t, t],
    [0, y, -(half - t / 2), outer, t, t],
    [half - t / 2, y, 0, t, t, sideLen],
    [-(half - t / 2), y, 0, t, t, sideLen],
  ] as const
}

const RING_Y = 0.27
const RING_T = 0.028

const BorderLayer: FC<{
  groupRef?: Ref<Group>
  y?: number
  thickness?: number
  outer?: number
  color: string
}> = ({
  groupRef,
  y = RING_Y,
  thickness = RING_T,
  outer = 1,
  color,
}) => (
  <group ref={groupRef}>
    {borderBars(y, thickness, outer).map(([x, yy, z, w, h, d], i) => (
      <mesh key={i} position={[x, yy, z]}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    ))}
  </group>
)

const LastMoveBorder: FC = () => (
  <BorderLayer color="#5eb0ff" />
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
        y={RING_Y - 0.004}
        thickness={RING_T * 1.35}
        color="#0d6b32"
      />
      <BorderLayer groupRef={core} y={RING_Y + 0.006} color="#7dff9c" />
    </group>
  )
}

const PieceSafetyBadge: FC<{ safety: PieceSafety }> = ({ safety }) => (
  <BorderLayer
    y={
      safety === 'hanging'
        ? RING_Y + 0.004
        : safety === 'contested'
          ? RING_Y + 0.002
          : safety === 'loose'
            ? RING_Y
            : RING_Y - 0.002
    }
    color={PIECE_SAFETY_COLOR[safety]}
  />
)

const OppCheckRing: FC = () => (
  <BorderLayer y={RING_Y + 0.008} color="#2dd4bf" />
)

const WrongMoveWash: FC = () => (
  <mesh position={[0, 0.29, 0]} rotation={[-Math.PI / 2, 0, 0]}>
    <planeGeometry args={[0.92, 0.92]} />
    <meshBasicMaterial
      color="#c4a035"
      transparent
      opacity={0.45}
      depthWrite={false}
      toneMapped={false}
    />
  </mesh>
)

const PremoveWash: FC = () => (
  <mesh position={[0, 0.295, 0]} rotation={[-Math.PI / 2, 0, 0]}>
    <planeGeometry args={[0.92, 0.92]} />
    <meshBasicMaterial
      color="#7c3aed"
      transparent
      opacity={0.38}
      depthWrite={false}
      toneMapped={false}
    />
  </mesh>
)

const PremoveBorder: FC = () => (
  <BorderLayer y={RING_Y + 0.01} color="#a78bfa" />
)

const TradeMarker: FC<{ preview: MovePreview }> = ({ preview }) => {
  const trade = preview.captureTrade
  if (!trade) return null
  const label = tradeMarkerLabel(trade)
  const color = tradeMarkerColor(trade.label)
  return (
    <Billboard position={[0, 0.72, 0]} follow lockX={false} lockY={false} lockZ={false}>
      <Text
        fontSize={0.38}
        color={color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.03}
        outlineColor="#0a0a0c"
        depthOffset={-1}
      >
        {label}
      </Text>
    </Billboard>
  )
}

export const TileComponent: FC<{
  canMoveHere: Position | null
  color: string
  isTip?: boolean
  isCheck?: boolean
  isLastMove?: boolean
  isWrongAttempt?: boolean
  isPremove?: boolean
  pieceSafety?: PieceSafety | null
  /** Hovered legal move would check — ring their king */
  isOppCheckPreview?: boolean
  mode?: 'solid' | 'hit'
  position: [number, number, number]
  onClick?: (e: { stopPropagation: () => void }) => void
  movePreview?: MovePreview | null
  onPreviewHover?: (
    preview: MovePreview | null,
    clientX: number,
    clientY: number,
    destKey?: string | null,
  ) => void
}> = memo(function TileComponent({
  color,
  canMoveHere,
  isTip = false,
  isCheck = false,
  isLastMove = false,
  isWrongAttempt = false,
  isPremove = false,
  pieceSafety = null,
  isOppCheckPreview = false,
  mode = 'solid',
  position,
  onClick,
  movePreview = null,
  onPreviewHover,
}) {
  const previewWash =
    canMoveHere && movePreview ? washColorForPreview(movePreview) : null
  const tileColor = getColor(color, !!canMoveHere, isCheck, previewWash)
  const emissiveColor = getEmissive(color, !!canMoveHere, isCheck, previewWash)
  const showHighlight = !!canMoveHere || isCheck
  const destKey = canMoveHere
    ? `${canMoveHere.x},${canMoveHere.y}`
    : null

  const pointerHandlers = canMoveHere
    ? {
        onPointerOver: (e: {
          stopPropagation: () => void
          nativeEvent: { clientX: number; clientY: number }
        }) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
          onPreviewHover?.(
            movePreview ?? null,
            e.nativeEvent.clientX,
            e.nativeEvent.clientY,
            destKey,
          )
        },
        onPointerMove: (e: {
          nativeEvent: { clientX: number; clientY: number }
        }) => {
          if (!movePreview) return
          onPreviewHover?.(
            movePreview,
            e.nativeEvent.clientX,
            e.nativeEvent.clientY,
            destKey,
          )
        },
        onPointerOut: () => {
          document.body.style.cursor = 'auto'
          onPreviewHover?.(null, 0, 0, null)
        },
      }
    : undefined

  const overlays = (
    <>
      {isWrongAttempt && <WrongMoveWash />}
      {isPremove && !isWrongAttempt && (
        <>
          <PremoveWash />
          <PremoveBorder />
        </>
      )}
      {isLastMove && !isWrongAttempt && !isPremove && <LastMoveBorder />}
      {isTip && <BestMoveBorder />}
      {isOppCheckPreview && <OppCheckRing />}
      {pieceSafety && <PieceSafetyBadge safety={pieceSafety} />}
      {canMoveHere && movePreview?.captureTrade && (
        <TradeMarker preview={movePreview} />
      )}
    </>
  )

  if (mode === 'hit') {
    return (
      <group position={position} onClick={onClick} {...pointerHandlers}>
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
        {overlays}
      </group>
    )
  }

  return (
    <group position={position} onClick={onClick} {...pointerHandlers}>
      <mesh scale={[1, 0.5, 1]} receiveShadow>
        <boxGeometry />
        <meshStandardMaterial
          color={tileColor}
          emissive={emissiveColor}
          emissiveIntensity={showHighlight ? 0.55 : 0}
          metalness={0.35}
          roughness={0.75}
          envMapIntensity={0.1}
        />
      </mesh>
      {overlays}
    </group>
  )
})
