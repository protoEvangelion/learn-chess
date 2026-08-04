import type { FC } from 'react'
import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import type { Object3D } from 'three'
import type { BoardTheme } from '@/lib/themes'

export const BoardSurface: FC<{ theme: BoardTheme }> = ({ theme }) => {
  if (!theme.modelPath) return null
  return <BoardGlb theme={theme} />
}

const BoardGlb: FC<{ theme: BoardTheme }> = ({ theme }) => {
  const { scene } = useGLTF(theme.modelPath!)
  const clone = useMemo(() => {
    const c = scene.clone(true)
    c.traverse((obj: Object3D) => {
      const mesh = obj as Object3D & {
        isMesh?: boolean
        castShadow?: boolean
        receiveShadow?: boolean
      }
      if (mesh.isMesh) {
        mesh.castShadow = false
        mesh.receiveShadow = true
      }
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

/** Prefetch a board GLB when the user selects it (not all themes at startup). */
export function preloadBoard(theme: BoardTheme) {
  if (theme.modelPath) useGLTF.preload(theme.modelPath)
}
