/**
 * Strip baked board-tile slabs from chessset piece GLBs, then drop to y=0.
 * Usage: node scripts/strip-chessset-tiles.mjs
 */
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup } from '@gltf-transform/functions'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pieceDir = path.join(rootDir, 'public/assets/pieces/chessset')
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

/** Rim verts below this are tile; crowns may overhang above. */
const RIM_Y_MAX = 0.35
const RIM_XZ = 0.42

async function stripFile(filePath) {
  const src = await io.read(filePath)
  const prim = src.getRoot().listMeshes()[0]?.listPrimitives()[0]
  if (!prim) throw new Error(`no prim ${filePath}`)
  const posAttr = prim.getAttribute('POSITION')
  const nrmAttr = prim.getAttribute('NORMAL')
  const uvAttr = prim.getAttribute('TEXCOORD_0')
  const idxAttr = prim.getIndices()
  const mat = prim.getMaterial()
  const tex = mat?.getBaseColorTexture()
  if (!posAttr || !nrmAttr || !uvAttr || !idxAttr || !tex) {
    throw new Error(`missing attrs ${filePath}`)
  }

  const pos = posAttr.getArray()
  const nrm = nrmAttr.getArray()
  const uvs = uvAttr.getArray()
  const idx = idxAttr.getArray()

  let tileTop = 0
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]
    const y = pos[i + 1]
    const z = pos[i + 2]
    if (y < RIM_Y_MAX && (Math.abs(x) > RIM_XZ || Math.abs(z) > RIM_XZ)) {
      tileTop = Math.max(tileTop, y)
    }
  }
  if (tileTop <= 0) {
    console.log('skip (no rim tile)', path.basename(filePath))
    return false
  }

  const keep = []
  for (let t = 0; t < idx.length / 3; t++) {
    const a = idx[t * 3]
    const b = idx[t * 3 + 1]
    const c = idx[t * 3 + 2]
    const maxY = Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1])
    if (maxY <= tileTop + 1e-4) continue
    keep.push(a, b, c)
  }
  if (keep.length === 0) throw new Error(`stripped everything ${filePath}`)

  const remap = new Map()
  const positions = []
  const normals = []
  const outUvs = []
  const outIdx = []
  const add = (vi) => {
    if (remap.has(vi)) return remap.get(vi)
    const i = positions.length / 3
    positions.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2])
    normals.push(nrm[vi * 3], nrm[vi * 3 + 1], nrm[vi * 3 + 2])
    outUvs.push(uvs[vi * 2], uvs[vi * 2 + 1])
    remap.set(vi, i)
    return i
  }
  for (let i = 0; i < keep.length; i += 3) {
    outIdx.push(add(keep[i]), add(keep[i + 1]), add(keep[i + 2]))
  }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i])
    maxX = Math.max(maxX, positions[i])
    minY = Math.min(minY, positions[i + 1])
    minZ = Math.min(minZ, positions[i + 2])
    maxZ = Math.max(maxZ, positions[i + 2])
  }
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx
    positions[i + 1] -= minY
    positions[i + 2] -= cz
  }

  const imageBytes = tex.getImage()
  const mimeType = tex.getMimeType() || 'image/png'

  const doc = new Document()
  const buffer = doc.createBuffer()
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(positions))
    .setBuffer(buffer)
  const normal = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(normals))
    .setBuffer(buffer)
  const texcoord = doc
    .createAccessor()
    .setType('VEC2')
    .setArray(new Float32Array(outUvs))
    .setBuffer(buffer)
  const index = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Uint32Array(outIdx))
    .setBuffer(buffer)
  const image = doc.createTexture('palette').setImage(imageBytes).setMimeType(mimeType)
  const material = doc
    .createMaterial('palette')
    .setBaseColorTexture(image)
    .setMetallicFactor(0)
    .setRoughnessFactor(1)
  const outPrim = doc
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setAttribute('NORMAL', normal)
    .setAttribute('TEXCOORD_0', texcoord)
    .setIndices(index)
    .setMaterial(material)
  const mesh = doc.createMesh('mesh').addPrimitive(outPrim)
  doc.createScene('Scene').addChild(doc.createNode('root').setMesh(mesh))

  await io.write(filePath, doc)
  const written = await io.read(filePath)
  await written.transform(dedup(), prune())
  await io.write(filePath, written)

  const h = Math.max(...positions.filter((_, i) => i % 3 === 1))
  const fp = (maxX - minX) * (maxZ - minZ)
  console.log(
    path.basename(filePath),
    `tileTop=${tileTop.toFixed(3)}`,
    `tris ${idx.length / 3}→${outIdx.length / 3}`,
    `fp ${fp.toFixed(3)}`,
    `h ${h.toFixed(3)}`,
  )
  return true
}

const files = fs
  .readdirSync(pieceDir)
  .filter((f) => f.endsWith('.glb'))
  .sort()
for (const f of files) {
  await stripFile(path.join(pieceDir, f))
}
console.log('done', files.length)
