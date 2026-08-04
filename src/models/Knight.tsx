import type { FC } from 'react'
import { useGLTF } from '@react-three/drei'
import type * as THREE from 'three'
import type { GLTF } from 'three-stdlib'

type GLTFResult = GLTF & {
  nodes: { Object001005: THREE.Mesh }
  materials: { ['Object001_mtl.003']: THREE.MeshStandardMaterial }
}

export const KnightComponent: FC = () => {
  const { nodes } = useGLTF(`/knight.gltf`) as unknown as GLTFResult
  return <primitive object={nodes.Object001005.geometry} attach="geometry" />
}

useGLTF.preload(`/knight.gltf`)
