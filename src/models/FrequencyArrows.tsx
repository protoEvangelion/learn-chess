import { useMemo, type FC } from 'react'
import * as THREE from 'three'
import { squareToPosition } from '@/lib/fenBridge'
import type { FrequencyArrow } from '@/lib/replyArrows'

const Y = 0.62
const COLOR = '#3b82f6'
const UP = new THREE.Vector3(0, 1, 0)

function arrowPlacement(fromSq: string, toSq: string) {
  const from = squareToPosition(fromSq)
  const to = squareToPosition(toSq)
  const start = new THREE.Vector3(from.x, Y, from.y)
  const end = new THREE.Vector3(to.x, Y, to.y)
  const delta = end.clone().sub(start)
  const len = delta.length()
  if (len < 0.2) return null
  const dir = delta.clone().normalize()
  const headLen = Math.min(0.42, len * 0.34)
  const shaftLen = Math.max(len - headLen, 0.2)
  const shaftMid = start.clone().add(dir.clone().multiplyScalar(shaftLen / 2 + 0.12))
  const headMid = end.clone().sub(dir.clone().multiplyScalar(headLen / 2))
  const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, dir)
  return { shaftMid, shaftLen, headMid, quaternion }
}

const MoveArrow: FC<FrequencyArrow> = ({ from, to, opacity }) => {
  const place = useMemo(() => arrowPlacement(from, to), [from, to])
  if (!place) return null
  return (
    <group>
      <mesh
        position={place.shaftMid}
        quaternion={place.quaternion}
        frustumCulled={false}
        renderOrder={4}
      >
        <cylinderGeometry args={[0.055, 0.055, place.shaftLen, 8]} />
        <meshBasicMaterial
          color={COLOR}
          transparent
          opacity={opacity}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      <mesh
        position={place.headMid}
        quaternion={place.quaternion}
        frustumCulled={false}
        renderOrder={4}
      >
        <coneGeometry args={[0.16, 0.42, 8]} />
        <meshBasicMaterial
          color={COLOR}
          transparent
          opacity={opacity}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

export const FrequencyArrows: FC<{ arrows: FrequencyArrow[] }> = ({ arrows }) => {
  if (arrows.length === 0) return null
  return (
    <group>
      {arrows.map((arrow) => (
        <MoveArrow key={`${arrow.from}${arrow.to}`} {...arrow} />
      ))}
    </group>
  )
}
