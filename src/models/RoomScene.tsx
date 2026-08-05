import type { FC } from 'react'
import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import type { Mesh, Object3D } from 'three'
import type { RoomTheme } from '@/lib/themes'

export const RoomScene: FC<{ theme: RoomTheme }> = ({ theme }) => {
  if (!theme.modelPath) return null
  return <RoomGlb theme={theme} />
}

const RoomGlb: FC<{ theme: RoomTheme }> = ({ theme }) => {
  const { scene } = useGLTF(theme.modelPath!)
  const clone = useMemo(() => {
    const c = scene.clone(true)
    c.traverse((obj: Object3D) => {
      const mesh = obj as Mesh
      if (!mesh.isMesh) return
      const name = (mesh.name || mesh.parent?.name || '').toLowerCase()
      const isTable = name.includes('table') || name.includes('dining')
      const isFloor =
        name.includes('floor') || name.includes('carpet') || name.includes('rug')
      mesh.castShadow = isTable
      mesh.receiveShadow = isTable || isFloor || name.includes('wall')
    })
    return c
  }, [scene])

  return (
    <group
      position={theme.position}
      scale={theme.scale}
      rotation={theme.rotation}
    >
      <primitive object={clone} />
    </group>
  )
}

/** Prefetch room GLB when selected. */
export function preloadRoom(theme: RoomTheme) {
  if (theme.modelPath) useGLTF.preload(theme.modelPath)
}
