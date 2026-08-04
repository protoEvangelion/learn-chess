/**
 * Split Sketchfab chess_board.glb (Al / lightningocelot, CC-BY) into board + pieces.
 * Usage: node scripts/split-chess-board.mjs [path-to-glb]
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
  process.argv[2] || path.join(process.env.HOME, 'Downloads/chess_board.glb')

const TARGET_BOARD = 8
/** Source board playable span (Object_19). */
const SRC_BOARD_SPAN = 16

const BOARD_NODES = ['Object_19', 'Object_36']
const PIECES = {
  white: {
    king: 'Object_7',
    queen: 'Object_6',
    bishop: 'Object_5',
    knight: 'Object_4',
    rook: 'Object_3',
    pawn: 'Object_8',
  },
  black: {
    king: 'Object_35',
    queen: 'Object_20',
    bishop: 'Object_34',
    knight: 'Object_33',
    rook: 'Object_32',
    pawn: 'Object_24',
  },
}

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
 * Bake world positions first (while hierarchy intact), then prune and recenter.
 */
async function extractNodes(srcDoc, nodeNames, outPath, mode, refBox) {
  const doc = cloneDocument(srcDoc)
  const meshNodes = nodeNames.map((name) => {
    const n = findNode(doc, name)
    if (!n?.getMesh()) throw new Error(`Missing mesh node ${name}`)
    return n
  })

  // Bake while parents still exist
  const bakedMaps = meshNodes.map((n) => ({
    node: n,
    parts: meshWorldPositions(n),
  }))

  const union = new THREE.Box3()
  for (const { parts } of bakedMaps) union.union(boxFromBaked(parts))

  const playBox = refBox
    ? (() => {
        const ref = bakedMaps.find((b) => b.node.getName() === refBox)
        return boxFromBaked(ref.parts)
      })()
    : union

  const center = playBox.getCenter(new THREE.Vector3())
  const topY = playBox.max.y
  const bottomY = playBox.min.y
  const S = TARGET_BOARD / SRC_BOARD_SPAN

  for (const { node, parts } of bakedMaps) {
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
  const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1)
  console.log('wrote', outPath, `(${mb} MB)`, {
    S,
    play: playBox.getSize(new THREE.Vector3()).toArray().map((n) => +n.toFixed(2)),
  })
}

const src = await io.read(srcPath)
console.log('source', srcPath)

await extractNodes(
  src,
  BOARD_NODES,
  path.join(rootDir, 'public/assets/boards/glass/model.glb'),
  'board',
  'Object_19',
)

const pieceDir = path.join(rootDir, 'public/assets/pieces/glass')
for (const [color, map] of Object.entries(PIECES)) {
  const suffix = color === 'white' ? 'w' : 'b'
  for (const [kind, nodeName] of Object.entries(map)) {
    const fresh = await io.read(srcPath)
    await extractNodes(
      fresh,
      [nodeName],
      path.join(pieceDir, `${kind}-${suffix}.glb`),
      'piece',
    )
  }
}

console.log('done')
