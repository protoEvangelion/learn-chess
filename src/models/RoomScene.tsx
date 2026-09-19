import type { FC } from 'react'
import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import type { Mesh, Object3D } from 'three'
import type { RoomTheme } from '@/lib/themes'

export const RoomScene: FC<{ theme: RoomTheme }> = ({ theme }) => {
  if (!theme.modelPath) return null
  return <RoomGlb theme={theme} />
}

const RoomTable: FC<{
  table: NonNullable<RoomTheme['table']>
}> = ({ table }) => {
  const [tw, th, td] = table.topSize
  const height = table.height
  const color = table.color ?? '#6b3f24'
  const legColor = table.legColor ?? '#4a2c18'
  const legW = Math.min(tw, td) * 0.07
  const legH = Math.max(0.05, height - th)
  const insetX = tw * 0.5 - legW * 0.85
  const insetZ = td * 0.5 - legW * 0.85
  const legs: [number, number][] = [
    [-insetX, -insetZ],
    [insetX, -insetZ],
    [-insetX, insetZ],
    [insetX, insetZ],
  ]

  return (
    <group position={table.position ?? [0, 0, 0]} name="CoffeeTable">
      <mesh
        name="CoffeeTableTop"
        position={[0, height - th / 2, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[tw, th, td]} />
        <meshStandardMaterial color={color} roughness={0.72} metalness={0.05} />
      </mesh>
      {legs.map(([x, z], i) => (
        <mesh
          key={i}
          name={`CoffeeTableLeg${i}`}
          position={[x, legH / 2, z]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[legW, legH, legW]} />
          <meshStandardMaterial
            color={legColor}
            roughness={0.8}
            metalness={0.02}
          />
        </mesh>
      ))}
    </group>
  )
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
      {theme.table ? <RoomTable table={theme.table} /> : null}
    </group>
  )
}

/** Prefetch room GLB when selected. */
export function preloadRoom(theme: RoomTheme) {
  if (theme.modelPath) useGLTF.preload(theme.modelPath)
}
