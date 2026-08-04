import type { FC } from 'react'

export const Border: FC = () => (
  <mesh
    onClick={(e) => e.stopPropagation()}
    receiveShadow
    position={[0, -0.35, 0]}
  >
    <boxGeometry args={[9, 0.5, 9]} />
    <meshPhysicalMaterial
      reflectivity={3}
      color="#c6c6c6"
      emissive="#323232"
      metalness={0.8}
      roughness={0.7}
      envMapIntensity={0.15}
      clearcoat={1}
      clearcoatRoughness={0.1}
    />
  </mesh>
)
