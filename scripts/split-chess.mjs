/**
 * Split Sketchfab chess.glb (Verfassen) into board + pieces.
 * https://sketchfab.com/3d-models/chess-e54c2d04d4f74823b69ba4a794fb4500
 *
 * Usage: node scripts/split-chess.mjs [path-to-glb]
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup, cloneDocument } from '@gltf-transform/functions'
import * as THREE from 'three'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcPath =
  process.argv[2] || path.join(process.env.HOME, 'Downloads/chess.glb')

const TARGET_BOARD = 8

/** Parent Circle nodes — one of each piece type per color.
 *  White d-file = Circle.008 (queen), e-file = Circle.007 (king).
 */
const PIECES = {
  white: {
    pawn: 'Circle.025',
    rook: 'Circle.031',
    knight: 'Circle.033',
    bishop: 'Circle.032',
    queen: 'Circle.008',
    king: 'Circle.007',
  },
  black: {
    pawn: 'Circle.011',
    rook: 'Circle.036',
    knight: 'Circle.034',
    bishop: 'Circle.028',
    queen: 'Circle.029',
    king: 'Circle.035',
  },
}

const BOARD_MESHES = [
  'Plane_light_0',
  'Plane_dark_0',
  'Plane_gold_0',
  'Plane_Shedua_0',
]

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

function findNode(doc, name) {
  return doc.getRoot().listNodes().find((n) => n.getName() === name)
}

function worldMatrix(node) {
  const m = new THREE.Matrix4()
  const chain = []
  let n = node
  while (n) {
    chain.unshift(n)
    n = n.getParentNode()
  }
  for (const node of chain) {
    m.multiply(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...node.getTranslation()),
        new THREE.Quaternion(...node.getRotation()),
        new THREE.Vector3(...node.getScale()),
      ),
    )
  }
  return m
}

function collectMeshNodes(root) {
  const out = []
  const walk = (n) => {
    if (n.getMesh()) out.push(n)
    for (const c of n.listChildren()) walk(c)
  }
  walk(root)
  return out
}

function meshWorldPositions(meshNode) {
  const wm = worldMatrix(meshNode)
  const v = new THREE.Vector3()
  const out = []
  for (const prim of meshNode.getMesh().listPrimitives()) {
    const arr = prim.getAttribute('POSITION').getArray()
    const baked = new Float32Array(arr.length)
    for (let i = 0; i < arr.length; i += 3) {
      v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(wm)
      baked[i] = v.x
      baked[i + 1] = v.y
      baked[i + 2] = v.z
    }
    out.push({ prim, baked })
  }
  return out
}

function boxFromBaked(bakedList) {
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (const { baked } of bakedList) {
    for (let i = 0; i < baked.length; i += 3) {
      v.set(baked[i], baked[i + 1], baked[i + 2])
      box.expandByPoint(v)
    }
  }
  return box
}

/**
 * Bake world positions, scale to TARGET_BOARD using playBox XZ, recenter.
 * board: top face → y=0; piece: bottom → y=0.
 */
async function extractNodes(srcDoc, nodeNames, outPath, mode, playBox) {
  const doc = cloneDocument(srcDoc)
  const meshNodes = nodeNames.map((name) => {
    const n = findNode(doc, name)
    if (!n?.getMesh()) throw new Error(`Missing mesh node ${name}`)
    return n
  })

  const bakedMaps = meshNodes.map((n) => ({
    node: n,
    parts: meshWorldPositions(n),
  }))

  const union = new THREE.Box3()
  for (const { parts } of bakedMaps) union.union(boxFromBaked(parts))

  const span = Math.max(
    playBox.max.x - playBox.min.x,
    playBox.max.z - playBox.min.z,
  )
  const S = TARGET_BOARD / span
  const boardCenter = playBox.getCenter(new THREE.Vector3())
  const pieceCenter = union.getCenter(new THREE.Vector3())
  const center =
    mode === 'board'
      ? boardCenter
      : new THREE.Vector3(pieceCenter.x, 0, pieceCenter.z)
  const topY = playBox.max.y
  const bottomY = mode === 'board' ? playBox.max.y : union.min.y

  for (const { parts } of bakedMaps) {
    for (const { prim, baked } of parts) {
      const out = new Float32Array(baked.length)
      for (let i = 0; i < baked.length; i += 3) {
        out[i] = (baked[i] - center.x) * S
        out[i + 1] =
          mode === 'board'
            ? (baked[i + 1] - topY) * S
            : (baked[i + 1] - bottomY) * S
        out[i + 2] = (baked[i + 2] - center.z) * S
      }
      prim.getAttribute('POSITION').setArray(out)
    }
  }

  const keep = new Set()
  const visit = (n) => {
    keep.add(n)
    for (const c of n.listChildren()) visit(c)
    const mesh = n.getMesh()
    if (!mesh) return
    keep.add(mesh)
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial()
      if (mat) keep.add(mat)
    }
  }
  for (const n of meshNodes) visit(n)

  const scene = doc.getRoot().listScenes()[0]
  for (const n of [...doc.getRoot().listNodes()]) {
    if (!keep.has(n)) n.dispose()
  }
  for (const child of [...scene.listChildren()]) scene.removeChild(child)
  for (const n of meshNodes) {
    const p = n.getParentNode()
    if (p) p.removeChild(n)
    scene.addChild(n)
    n.setTranslation([0, 0, 0])
    n.setRotation([0, 0, 0, 1])
    n.setScale([1, 1, 1])
  }

  await doc.transform(dedup(), prune())
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  await io.write(outPath, doc)
  const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2)
  console.log('wrote', outPath, `(${mb} MB)`, { S: +S.toFixed(5) })
}

function playableBox(srcDoc) {
  const light = findNode(srcDoc, 'Plane_light_0')
  const dark = findNode(srcDoc, 'Plane_dark_0')
  if (!light || !dark) throw new Error('Missing board squares')
  const box = new THREE.Box3()
  for (const n of [light, dark]) {
    box.union(boxFromBaked(meshWorldPositions(n)))
  }
  return box
}

function meshNamesUnder(srcDoc, parentName) {
  const parent = findNode(srcDoc, parentName)
  if (!parent) throw new Error(`Missing parent ${parentName}`)
  return collectMeshNodes(parent).map((n) => n.getName())
}

const src = await io.read(srcPath)
console.log('source', srcPath)
const playBox = playableBox(src)
console.log(
  'playable',
  playBox.getSize(new THREE.Vector3()).toArray().map((n) => +n.toFixed(2)),
)

await extractNodes(
  src,
  BOARD_MESHES,
  path.join(rootDir, 'public/assets/boards/verfassen/model.glb'),
  'board',
  playBox,
)

const pieceDir = path.join(rootDir, 'public/assets/pieces/verfassen')
for (const [color, map] of Object.entries(PIECES)) {
  const suffix = color === 'white' ? 'w' : 'b'
  for (const [kind, parentName] of Object.entries(map)) {
    const fresh = await io.read(srcPath)
    const meshNames = meshNamesUnder(fresh, parentName)
    await extractNodes(
      fresh,
      meshNames,
      path.join(pieceDir, `${kind}-${suffix}.glb`),
      'piece',
      playBox,
    )
  }
}

console.log('done')
