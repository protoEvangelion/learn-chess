import type { FC } from 'react'
import { useGLTF } from '@react-three/drei'
import type * as THREE from 'three'
import type { GLTF } from 'three-stdlib'

type GLTFResult = GLTF & {
  nodes: { Object001: THREE.Mesh }
  materials: { ['Object001_mtl.003']: THREE.MeshStandardMaterial }
}

export const PawnModel: FC = () => {
  const { nodes } = useGLTF(`/pawn.gltf`) as unknown as GLTFResult
  return <primitive object={nodes.Object001.geometry} attach="geometry" />
}

useGLTF.preload(`/pawn.gltf`)
