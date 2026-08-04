import type { FC } from 'react'
import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import type * as THREE from 'three'
import type { GLTF } from 'three-stdlib'
import type { PieceColorPaths, PieceSetTheme } from '@/lib/themes'

type ClassicNodes = {
  pawn: 'Object001'
  rook: 'Object001001'
  knight: 'Object001005'
  bishop: 'Object001002'
  queen: 'Object001003'
  king: 'Object001004'
}

const CLASSIC_NODES: ClassicNodes = {
  pawn: 'Object001',
  rook: 'Object001001',
  knight: 'Object001005',
  bishop: 'Object001002',
  queen: 'Object001003',
  king: 'Object001004',
}

const CLASSIC_PATHS = {
  pawn: '/pawn.gltf',
  rook: '/rook.gltf',
  knight: '/knight.gltf',
  bishop: '/bishop.gltf',
  queen: '/queen.gltf',
  king: '/king.gltf',
} as const

export type PieceKind = keyof typeof CLASSIC_PATHS

function resolvePath(
  paths: PieceSetTheme['paths'],
  kind: PieceKind,
  color: string,
): string {
  const entry = paths![kind]
  if (typeof entry === 'string') return entry
  const colored = entry as PieceColorPaths
  return color === 'black' ? colored.black : colored.white
}

export const PieceModel: FC<{
  kind: PieceKind
  pieceSet: PieceSetTheme
  color?: string
}> = ({ kind, pieceSet, color = 'white' }) => {
  if (pieceSet.kind === 'classic') {
    return <ClassicPiece kind={kind} />
  }
  if (pieceSet.kind === 'textured') {
    return <TexturedPiece kind={kind} pieceSet={pieceSet} color={color} />
  }
  return <GlbPiece kind={kind} pieceSet={pieceSet} color={color} />
}

const ClassicPiece: FC<{ kind: PieceKind }> = ({ kind }) => {
  const path = CLASSIC_PATHS[kind]
  const { nodes } = useGLTF(path) as unknown as GLTF & {
    nodes: Record<string, THREE.Mesh>
  }
  const nodeName = CLASSIC_NODES[kind]
  return <primitive object={nodes[nodeName].geometry} attach="geometry" />
}

const GlbPiece: FC<{
  kind: PieceKind
  pieceSet: PieceSetTheme
  color: string
}> = ({ kind, pieceSet, color }) => {
  const path = resolvePath(pieceSet.paths, kind, color)
  const { nodes, scene } = useGLTF(path) as unknown as GLTF & {
    nodes: Record<string, THREE.Mesh>
  }
  const mesh =
    nodes[kind] ??
    (Object.values(nodes).find((n) => (n as THREE.Mesh).isMesh) as THREE.Mesh)
  if (mesh?.geometry) {
    return <primitive object={mesh.geometry} attach="geometry" />
  }
  let geo: THREE.BufferGeometry | null = null
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (!geo && m.isMesh) geo = m.geometry
  })
  if (!geo) return null
  return <primitive object={geo} attach="geometry" />
}

const TexturedPiece: FC<{
  kind: PieceKind
  pieceSet: PieceSetTheme
  color: string
}> = ({ kind, pieceSet, color }) => {
  const path = resolvePath(pieceSet.paths, kind, color)
  const { scene } = useGLTF(path)
  const clone = useMemo(() => {
    const c = scene.clone(true)
    c.traverse((obj) => {
      const m = obj as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = false
      }
    })
    return c
  }, [scene])
  const yawEntry = pieceSet.yawByType?.[kind]
  const yaw =
    typeof yawEntry === 'number'
      ? yawEntry
      : yawEntry
        ? color === 'black'
          ? yawEntry.black
          : yawEntry.white
        : 0
  return (
    <group rotation={[0, yaw, 0]}>
      <primitive object={clone} />
    </group>
  )
}

const KINDS = Object.keys(CLASSIC_PATHS) as PieceKind[]

/** Prefetch piece GLBs for a set when selected (avoids loading every theme at startup). */
export function preloadPieceSet(pieceSet: PieceSetTheme) {
  if (pieceSet.kind === 'classic') {
    for (const p of Object.values(CLASSIC_PATHS)) useGLTF.preload(p)
    return
  }
  if (!pieceSet.paths) return
  for (const kind of KINDS) {
    const entry = pieceSet.paths[kind]
    if (!entry) continue
    if (typeof entry === 'string') {
      useGLTF.preload(entry)
    } else {
      useGLTF.preload(entry.white)
      useGLTF.preload(entry.black)
    }
  }
}

// Small default set — always warm so first paint is smooth
for (const p of Object.values(CLASSIC_PATHS)) useGLTF.preload(p)
