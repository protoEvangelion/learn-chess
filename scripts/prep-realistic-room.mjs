/**
 * Prep realistic_room.glb (Sketchfab):
 * strip candle/tray clutter from the table, bake scale so the tabletop
 * fits under the chessboard.
 * https://sketchfab.com/3d-models/realistic-room-7b65ce7710b442d9932440d5b9812287
 *
 * Usage: node scripts/prep-realistic-room.mjs [path-to-glb]
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
  process.argv[2] ||
  path.join(process.env.HOME, 'Downloads/realistic_room.glb')

/** Candle holder + tray sitting on the coffee table. */
const STRIP_NODES = new Set(['Object_15', 'Object_6'])

/** Chessboard span in world units (retropc ≈ 9.1). */
const BOARD_SPAN = 9.15
/** Board covers this fraction of the table’s short side. */
const BOARD_TABLE_FIT = 0.55
/** Raise tabletop into the board a bit so it doesn’t float. */
const TABLE_TOP_Y = 0.08

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const src = await io.read(srcPath)
const doc = cloneDocument(src)

for (const node of [...doc.getRoot().listNodes()]) {
  const name = node.getName() || ''
  if (STRIP_NODES.has(name)) {
    console.log('strip', name)
    node.dispose()
  }
}

/** Clear-ish glass so a sharp HDR shows through (cheap; no refraction). */
for (const mat of doc.getRoot().listMaterials()) {
  if (mat.getName() !== 'Material.001') continue
  mat.setRoughnessFactor(0.12)
  mat.setMetallicFactor(0.15)
  mat.setBaseColorFactor([0.92, 0.95, 0.98, 0.22])
  mat.setAlpha(0.22)
  mat.setAlphaMode('BLEND')
  console.log('clear glass', mat.getName())
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

/** Coffee table = stolik.001 (Object_12). */
function tableBox() {
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh()
    if (!mesh) continue
    const mats = mesh
      .listPrimitives()
      .map((p) => p.getMaterial()?.getName() || '')
      .join(' ')
    if (!mats.includes('stolik.001')) continue
    const wm = worldMatrix(n)
    for (const prim of mesh.listPrimitives()) {
      const arr = prim.getAttribute('POSITION').getArray()
      for (let i = 0; i < arr.length; i += 3) {
        v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(wm)
        box.expandByPoint(v)
      }
    }
  }
  return box
}

const before = tableBox()
if (before.isEmpty()) {
  throw new Error('Could not find table mesh (stolik.001)')
}
const shortSide = Math.min(
  before.getSize(new THREE.Vector3()).x,
  before.getSize(new THREE.Vector3()).z,
)
const tableTarget = BOARD_SPAN / BOARD_TABLE_FIT
const S = tableTarget / shortSide
const center = before.getCenter(new THREE.Vector3())
const topY = before.max.y

console.log('table before', {
  size: before.getSize(new THREE.Vector3()).toArray().map((n) => +n.toFixed(3)),
  topY: +topY.toFixed(4),
  S: +S.toFixed(3),
})

const root = doc.getRoot().listScenes()[0]?.listChildren()[0]
if (!root) throw new Error('No scene root')

const t = root.getTranslation()
const s = root.getScale()
root.setTranslation([
  (t[0] - center.x) * S,
  (t[1] - topY) * S + TABLE_TOP_Y,
  (t[2] - center.z) * S,
])
root.setScale([s[0] * S, s[1] * S, s[2] * S])

await doc.transform(prune({ keepAttributes: true }), dedup())

const outDir = path.join(rootDir, 'public/assets/rooms/realistic')
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, 'room.glb')
await io.write(outPath, doc)
console.log('wrote', outPath, `(${(fs.statSync(outPath).size / 1e6).toFixed(1)} MB)`)

const after = tableBox()
console.log('table after', {
  size: after.getSize(new THREE.Vector3()).toArray().map((n) => +n.toFixed(3)),
  topY: +after.max.y.toFixed(4),
  center: after.getCenter(new THREE.Vector3()).toArray().map((n) => +n.toFixed(3)),
})
