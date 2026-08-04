/**
 * Prep modern_dining_room.glb: strip clutter, bake scale so tabletop
 * sits just under the chessboard (board bottom ≈ -0.26, top at 0).
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
  path.join(process.env.HOME, 'Downloads/modern_dining_room.glb')

const STRIP = new Set([
  'Pot',
  'Plant',
  'Camera',
  'Sun',
  'Object_8',
  'Object_12',
  'Object_13',
])

/** Chessboard span in world units (retropc ≈ 9.1). */
const BOARD_SPAN = 9.15
/** Board should cover this fraction of the table’s short side (smaller = more table margin). */
const BOARD_TABLE_FIT = 0.55
/** Raise tabletop into the board a bit so it doesn’t float (board top=0, thickness≈0.26). */
const TABLE_TOP_Y = 0.08

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const src = await io.read(srcPath)
const doc = cloneDocument(src)

for (const node of [...doc.getRoot().listNodes()]) {
  const name = node.getName() || ''
  if ([...STRIP].some((s) => name === s || name.startsWith(s + '_'))) {
    node.dispose()
  }
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

function tableBox() {
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh()
    if (!mesh) continue
    const label = `${n.getName() || ''} ${n.getParentNode()?.getName() || ''}`
    if (!label.includes('DiningTable')) continue
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
  tableTarget: +tableTarget.toFixed(2),
})

// Bake: world → scale → recenter so tabletop @ TABLE_TOP_Y, table center xz @ 0
const v = new THREE.Vector3()
for (const n of doc.getRoot().listNodes()) {
  const mesh = n.getMesh()
  if (!mesh) continue
  const wm = worldMatrix(n)
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    const arr = pos.getArray()
    const out = new Float32Array(arr.length)
    for (let i = 0; i < arr.length; i += 3) {
      v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(wm)
      out[i] = (v.x - center.x) * S
      out[i + 1] = (v.y - topY) * S + TABLE_TOP_Y
      out[i + 2] = (v.z - center.z) * S
    }
    pos.setArray(out)
  }
  n.setTranslation([0, 0, 0])
  n.setRotation([0, 0, 0, 1])
  n.setScale([1, 1, 1])
}

// Zero all node transforms (already baked)
for (const n of doc.getRoot().listNodes()) {
  n.setTranslation([0, 0, 0])
  n.setRotation([0, 0, 0, 1])
  n.setScale([1, 1, 1])
}

await doc.transform(dedup(), prune())

const after = tableBox()
console.log('table after', {
  size: after.getSize(new THREE.Vector3()).toArray().map((n) => +n.toFixed(3)),
  y: [after.min.y, after.max.y].map((n) => +n.toFixed(3)),
})

const out = path.join(rootDir, 'public/assets/rooms/dining/room-v3.glb')
fs.mkdirSync(path.dirname(out), { recursive: true })
await io.write(out, doc)
console.log(
  'wrote',
  out,
  `(${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`,
)
