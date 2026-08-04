/**
 * Split Sketchfab retropc_chess.glb into board + one-of-each white pieces.
 * Usage: node scripts/split-retropc.mjs [path-to-glb]
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
  process.argv[2] || path.join(process.env.HOME, 'Downloads/retropc_chess.glb')

const PIECES_WHITE = {
  pawn: 'pawn_w_22',
  rook: 'rook_w_34',
  knight: 'knight_w_9',
  bishop: 'bishop_w_2',
  queen: 'queen_w_31',
  king: 'king_w_6',
}

const PIECES_BLACK = {
  pawn: 'pawn_b_15',
  rook: 'rook_b_32',
  knight: 'knight_b_7',
  bishop: 'bishop_b_0',
  queen: 'queen_b_30',
  king: 'king_b_5',
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

/** Keep only `keepRoot` subtree; dispose everything else; re-root scene. */
async function extractSubtree(srcDoc, keepRootName, outPath, recenter) {
  const doc = cloneDocument(srcDoc)
  const keepRoot = findNode(doc, keepRootName)
  if (!keepRoot) throw new Error(`Missing node ${keepRootName}`)

  const keep = new Set()
  const visit = (n) => {
    keep.add(n)
    for (const c of n.listChildren()) visit(c)
  }
  visit(keepRoot)

  // Mark materials/textures/meshes still referenced
  for (const n of [...keep]) {
    const mesh = n.getMesh()
    if (!mesh) continue
    keep.add(mesh)
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial()
      if (mat) keep.add(mat)
    }
  }

  const scene = doc.getRoot().listScenes()[0]
  for (const n of [...doc.getRoot().listNodes()]) {
    if (!keep.has(n)) n.dispose()
  }

  // Clear scene roots and attach keepRoot
  for (const child of [...scene.listChildren()]) {
    scene.removeChild(child)
  }
  // Detach keepRoot from old parent
  const parent = keepRoot.getParentNode()
  if (parent) parent.removeChild(keepRoot)
  scene.addChild(keepRoot)

  // Bake world transform into the keepRoot local matrix, clear ancestors
  const meshNodes = []
  const collect = (n) => {
    if (n.getMesh()) meshNodes.push(n)
    for (const c of n.listChildren()) collect(c)
  }
  collect(keepRoot)

  // Compute AABB in world space before we rewrite transforms
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (const meshNode of meshNodes) {
    const wm = worldMatrix(meshNode)
    const mesh = meshNode.getMesh()
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      const arr = pos.getArray()
      for (let i = 0; i < arr.length; i += 3) {
        v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(wm)
        box.expandByPoint(v)
      }
    }
  }

  // Flatten: bake each mesh node's world matrix into POSITION, reset node xforms
  for (const meshNode of meshNodes) {
    const wm = worldMatrix(meshNode)
    const mesh = meshNode.getMesh()
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      const arr = pos.getArray()
      const out = new Float32Array(arr.length)
      for (let i = 0; i < arr.length; i += 3) {
        v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(wm)
        out[i] = v.x
        out[i + 1] = v.y
        out[i + 2] = v.z
      }
      // recenter
      const centerX = (box.min.x + box.max.x) / 2
      const centerZ = (box.min.z + box.max.z) / 2
      const bottomY = box.min.y
      for (let i = 0; i < out.length; i += 3) {
        if (recenter === 'board') {
          // center XZ, put top face at y=0
          out[i] -= centerX
          out[i + 1] -= box.max.y
          out[i + 2] -= centerZ
        } else {
          // piece: bottom-center at origin
          out[i] -= centerX
          out[i + 1] -= bottomY
          out[i + 2] -= centerZ
        }
      }
      pos.setArray(out)
    }
    meshNode.setTranslation([0, 0, 0])
    meshNode.setRotation([0, 0, 0, 1])
    meshNode.setScale([1, 1, 1])
  }

  keepRoot.setTranslation([0, 0, 0])
  keepRoot.setRotation([0, 0, 0, 1])
  keepRoot.setScale([1, 1, 1])
  // Zero intermediate parents under keepRoot
  const zero = (n) => {
    if (n !== keepRoot && !n.getMesh()) {
      n.setTranslation([0, 0, 0])
      n.setRotation([0, 0, 0, 1])
      n.setScale([1, 1, 1])
    }
    for (const c of n.listChildren()) zero(c)
  }
  zero(keepRoot)

  await doc.transform(dedup(), prune())

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  await io.write(outPath, doc)
  const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1)
  console.log('wrote', outPath, `(${mb} MB)`, {
    size: box.getSize(new THREE.Vector3()).toArray().map((n) => +n.toFixed(3)),
  })
}

const src = await io.read(srcPath)
console.log('source', srcPath)

const boardOut = path.join(rootDir, 'public/assets/boards/retropc/model.glb')
await extractSubtree(src, 'board_4', boardOut, 'board')

const pieceDir = path.join(rootDir, 'public/assets/pieces/retropc')
for (const [kind, nodeName] of Object.entries(PIECES_WHITE)) {
  const fresh = await io.read(srcPath)
  await extractSubtree(
    fresh,
    nodeName,
    path.join(pieceDir, `${kind}-w.glb`),
    'piece',
  )
}
for (const [kind, nodeName] of Object.entries(PIECES_BLACK)) {
  const fresh = await io.read(srcPath)
  await extractSubtree(
    fresh,
    nodeName,
    path.join(pieceDir, `${kind}-b.glb`),
    'piece',
  )
}

console.log('done')
