/**
 * Prep the_simpsons_living_room.glb (Sketchfab, CC-BY):
 * center + scale so the carpet/floor sits near y=0 and the room
 * fits a chessboard (~55% of a coffee-table footprint).
 * https://sketchfab.com/3d-models/the-simpsons-living-room-24f9058a77ef4f9ab172d6d06954bc82
 *
 * Usage: node scripts/prep-simpsons-room.mjs [path-to-glb]
 *
 * Note: the download has no table — RoomScene draws a procedural
 * coffee table for this theme (see themes.ts `table`).
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
  path.join(process.env.HOME, 'Downloads/the_simpsons_living_room.glb')

/** Chessboard span in world units (retropc ≈ 9.1). */
const BOARD_SPAN = 9.15
/** Board covers this fraction of the (procedural) table’s short side. */
const BOARD_TABLE_FIT = 0.55
/** Dense vertex band ≈ carpet/floor in the source mesh. */
const FLOOR_Y = -43.5
/** Target room horizontal span after scale (walls + furniture). */
const ROOM_TARGET = 52

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const src = await io.read(srcPath)
const doc = cloneDocument(src)

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

function sceneBox() {
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh()
    if (!mesh) continue
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

const before = sceneBox()
if (before.isEmpty()) throw new Error('Empty scene bounds')
const size = before.getSize(new THREE.Vector3())
const center = before.getCenter(new THREE.Vector3())
const S = ROOM_TARGET / Math.max(size.x, size.z)

console.log('before', {
  size: size.toArray().map((n) => +n.toFixed(3)),
  center: center.toArray().map((n) => +n.toFixed(3)),
  floorY: FLOOR_Y,
  S: +S.toFixed(4),
  tableShort: +(BOARD_SPAN / BOARD_TABLE_FIT).toFixed(2),
})

const root = doc.getRoot().listScenes()[0]?.listChildren()[0]
if (!root) throw new Error('No scene root')

const t = root.getTranslation()
const s = root.getScale()
root.setTranslation([
  (t[0] - center.x) * S,
  (t[1] - FLOOR_Y) * S,
  (t[2] - center.z) * S,
])
root.setScale([s[0] * S, s[1] * S, s[2] * S])

await doc.transform(prune({ keepAttributes: true }), dedup())

const outDir = path.join(rootDir, 'public/assets/rooms/simpsons')
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, 'room.glb')
await io.write(outPath, doc)
console.log('wrote', outPath, `(${(fs.statSync(outPath).size / 1e6).toFixed(2)} MB)`)

const after = sceneBox()
console.log('after', {
  size: after.getSize(new THREE.Vector3()).toArray().map((n) => +n.toFixed(3)),
  min: after.min.toArray().map((n) => +n.toFixed(3)),
  max: after.max.toArray().map((n) => +n.toFixed(3)),
  center: after.getCenter(new THREE.Vector3()).toArray().map((n) => +n.toFixed(3)),
})
