/**
 * Split Sketchfab chess-set.glb into board + pieces.
 * https://sketchfab.com/3d-models/chess-set-89509e3c894c40a68542bdc586b38c9c
 * Source is a single palette mesh; pieces are cut by starting-square XY cells.
 *
 * Usage: node scripts/split-chess-set.mjs [path-to-glb]
 */
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup } from '@gltf-transform/functions'
import * as THREE from 'three'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcPath =
  process.argv[2] || path.join(process.env.HOME, 'Downloads/chess_set.glb')

const TARGET_BOARD = 8
/** Full square ~1.27; pedestals ≪ 0.4. */
const MIN_BOARD_TILE_FP = 0.45

/** Standard starting squares → piece kinds (file 0=a … 7=h). */
const BACK_RANK = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook']

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

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

/** Sketchfab_model already applies -90° X (Z-up → Y-up); use world positions as-is. */
function toWorld(v) {
  return v.clone()
}

function writeMeshGlb({
  positions,
  normals,
  uvs,
  indices,
  imageBytes,
  mimeType,
  outPath,
}) {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(positions)
    .setBuffer(buffer)
  const normal = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(normals)
    .setBuffer(buffer)
  const texcoord = doc
    .createAccessor()
    .setType('VEC2')
    .setArray(uvs)
    .setBuffer(buffer)
  const index = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(indices)
    .setBuffer(buffer)

  const image = doc.createTexture('palette').setImage(imageBytes).setMimeType(mimeType)
  const material = doc
    .createMaterial('palette')
    .setBaseColorTexture(image)
    .setMetallicFactor(0)
    .setRoughnessFactor(1)

  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setAttribute('NORMAL', normal)
    .setAttribute('TEXCOORD_0', texcoord)
    .setIndices(index)
    .setMaterial(material)

  const mesh = doc.createMesh('mesh').addPrimitive(prim)
  const node = doc.createNode('root').setMesh(mesh)
  doc.createScene('Scene').addChild(node)

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  return io.write(outPath, doc).then(async () => {
    // prune unused after write isn't needed; compact via re-read
    const written = await io.read(outPath)
    await written.transform(dedup(), prune())
    await io.write(outPath, written)
    const kb = (fs.statSync(outPath).size / 1024).toFixed(1)
    console.log('wrote', outPath, `(${kb} KB)`)
  })
}

function extractTriangles(triIndices, worldVerts, worldNormals, srcUv, srcIndices) {
  const remap = new Map()
  const positions = []
  const normals = []
  const uvs = []
  const outIdx = []

  const addVert = (srcVi) => {
    if (remap.has(srcVi)) return remap.get(srcVi)
    const i = positions.length / 3
    const p = worldVerts[srcVi]
    const n = worldNormals[srcVi]
    positions.push(p.x, p.y, p.z)
    normals.push(n.x, n.y, n.z)
    uvs.push(srcUv[srcVi * 2], srcUv[srcVi * 2 + 1])
    remap.set(srcVi, i)
    return i
  }

  for (const ti of triIndices) {
    const a = srcIndices[ti * 3]
    const b = srcIndices[ti * 3 + 1]
    const c = srcIndices[ti * 3 + 2]
    outIdx.push(addVert(a), addVert(b), addVert(c))
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(outIdx),
  }
}

function recenter(mesh, mode, playBox) {
  const center = playBox.getCenter(new THREE.Vector3())
  const topY = playBox.max.y
  const bottomY = playBox.min.y
  const span = Math.max(playBox.max.x - playBox.min.x, playBox.max.z - playBox.min.z)
  const S = TARGET_BOARD / span
  const out = new Float32Array(mesh.positions.length)
  for (let i = 0; i < mesh.positions.length; i += 3) {
    out[i] = (mesh.positions[i] - center.x) * S
    out[i + 1] =
      mode === 'board'
        ? (mesh.positions[i + 1] - topY) * S
        : (mesh.positions[i + 1] - bottomY) * S
    out[i + 2] = (mesh.positions[i + 2] - center.z) * S
  }
  // normals: rotate already applied; scale is uniform so leave as-is (re-normalize)
  const nout = new Float32Array(mesh.normals.length)
  const tmp = new THREE.Vector3()
  for (let i = 0; i < mesh.normals.length; i += 3) {
    tmp.set(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]).normalize()
    nout[i] = tmp.x
    nout[i + 1] = tmp.y
    nout[i + 2] = tmp.z
  }
  return { ...mesh, positions: out, normals: nout, S, span }
}

const src = await io.read(srcPath)
const meshNode = src.getRoot().listNodes().find((n) => n.getMesh())
if (!meshNode) throw new Error('No mesh node')
const prim = meshNode.getMesh().listPrimitives()[0]
const posAttr = prim.getAttribute('POSITION')
const nrmAttr = prim.getAttribute('NORMAL')
const uvAttr = prim.getAttribute('TEXCOORD_0')
const idxAttr = prim.getIndices()
if (!posAttr || !nrmAttr || !uvAttr || !idxAttr) throw new Error('Missing attributes')

const srcPos = posAttr.getArray()
const srcNrm = nrmAttr.getArray()
const srcUv = uvAttr.getArray()
const srcIndices = idxAttr.getArray()
const wm = worldMatrix(meshNode)
const normalMatrix = new THREE.Matrix3().getNormalMatrix(wm)

const worldVerts = []
const worldNormals = []
const v = new THREE.Vector3()
const n = new THREE.Vector3()
for (let i = 0; i < srcPos.length; i += 3) {
  v.set(srcPos[i], srcPos[i + 1], srcPos[i + 2]).applyMatrix4(wm)
  worldVerts.push(toWorld(v))
  n.set(srcNrm[i], srcNrm[i + 1], srcNrm[i + 2])
    .applyMatrix3(normalMatrix)
    .normalize()
  worldNormals.push(n.clone())
}

const boardSpanX = (() => {
  const box = new THREE.Box3()
  for (const p of worldVerts) box.expandByPoint(p)
  return Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
})()
const half = boardSpanX / 2
const cell = boardSpanX / 8

const boardTris = []
/** @type {Map<string, number[]>} */
const pieceTris = new Map()

const mat = prim.getMaterial()
const tex = mat.getBaseColorTexture()
const imageBytes = tex.getImage()
const mimeType = tex.getMimeType() || 'image/png'

function isPieceSquare(rank) {
  return rank === 0 || rank === 1 || rank === 6 || rank === 7
}

function triFootprint(a, b, c) {
  const dx =
    Math.max(worldVerts[a].x, worldVerts[b].x, worldVerts[c].x) -
    Math.min(worldVerts[a].x, worldVerts[b].x, worldVerts[c].x)
  const dz =
    Math.max(worldVerts[a].z, worldVerts[b].z, worldVerts[c].z) -
    Math.min(worldVerts[a].z, worldVerts[b].z, worldVerts[c].z)
  return dx * dz
}

for (let ti = 0; ti < srcIndices.length / 3; ti++) {
  const a = srcIndices[ti * 3]
  const b = srcIndices[ti * 3 + 1]
  const c = srcIndices[ti * 3 + 2]
  const ca = worldVerts[a]
  const cb = worldVerts[b]
  const cc = worldVerts[c]
  const cx = (ca.x + cb.x + cc.x) / 3
  const cz = (ca.z + cb.z + cc.z) / 3
  const file = Math.min(7, Math.max(0, Math.floor((cx + half) / cell)))
  const rank = Math.min(7, Math.max(0, Math.floor((cz + half) / cell)))
  const key = `${file},${rank}`
  const fp = triFootprint(a, b, c)

  // Starting squares:
  // - large faces (board underside / full tiles) stay on the board
  // - small coplanar pads + anything above the board plane → piece
  //   (gold/charcoal body leftovers on the board were the yellow-square bug)
  let toPiece = false
  if (isPieceSquare(rank)) {
    if (fp >= MIN_BOARD_TILE_FP) {
      toPiece = false
    } else {
      toPiece = true
    }
  }

  if (toPiece) {
    if (!pieceTris.has(key)) pieceTris.set(key, [])
    pieceTris.get(key).push(ti)
  } else {
    boardTris.push(ti)
  }
}

const boardMeshRaw = extractTriangles(
  boardTris,
  worldVerts,
  worldNormals,
  srcUv,
  srcIndices,
)

// Starting ranks only had pedestals on the top plane — fill missing checkered
// tiles as full-thickness blocks matching mid-rank tile height.
const CREAM_U = 0.4668
const BLACK_U = 0.9355
const TILE_V = 0.5
/** Mid-rank tile top / bottom in source world space. */
const TILE_TOP_Y = 0.16078141331672657
const TILE_BOT_Y = 0
{
  const pos = [...boardMeshRaw.positions]
  const nrm = [...boardMeshRaw.normals]
  const uvs = [...boardMeshRaw.uvs]
  const idx = [...boardMeshRaw.indices]
  let base = pos.length / 3

  const pushVert = (x, y, z, nx, ny, nz, u) => {
    pos.push(x, y, z)
    nrm.push(nx, ny, nz)
    uvs.push(u, TILE_V)
    return base++
  }

  /** Quad with outward winding (a→b→c→d around face). */
  const pushQuad = (a, b, c, d) => {
    idx.push(a, c, b, a, d, c)
  }

  for (const rank of [0, 1, 6, 7]) {
    for (let file = 0; file < 8; file++) {
      const x0 = -half + file * cell
      const x1 = x0 + cell
      const z0 = -half + rank * cell
      const z1 = z0 + cell
      const cream = (file + rank) % 2 === 0
      const u = cream ? CREAM_U : BLACK_U

      // Top (+Y) — winding for +Y normal
      const t0 = pushVert(x0, TILE_TOP_Y, z0, 0, 1, 0, u)
      const t1 = pushVert(x1, TILE_TOP_Y, z0, 0, 1, 0, u)
      const t2 = pushVert(x1, TILE_TOP_Y, z1, 0, 1, 0, u)
      const t3 = pushVert(x0, TILE_TOP_Y, z1, 0, 1, 0, u)
      pushQuad(t0, t1, t2, t3)

      // Bottom (-Y)
      const b0 = pushVert(x0, TILE_BOT_Y, z0, 0, -1, 0, u)
      const b1 = pushVert(x1, TILE_BOT_Y, z0, 0, -1, 0, u)
      const b2 = pushVert(x1, TILE_BOT_Y, z1, 0, -1, 0, u)
      const b3 = pushVert(x0, TILE_BOT_Y, z1, 0, -1, 0, u)
      pushQuad(b0, b3, b2, b1)

      // Sides
      // -Z
      {
        const a = pushVert(x0, TILE_BOT_Y, z0, 0, 0, -1, u)
        const b = pushVert(x1, TILE_BOT_Y, z0, 0, 0, -1, u)
        const c = pushVert(x1, TILE_TOP_Y, z0, 0, 0, -1, u)
        const d = pushVert(x0, TILE_TOP_Y, z0, 0, 0, -1, u)
        pushQuad(a, b, c, d)
      }
      // +Z
      {
        const a = pushVert(x1, TILE_BOT_Y, z1, 0, 0, 1, u)
        const b = pushVert(x0, TILE_BOT_Y, z1, 0, 0, 1, u)
        const c = pushVert(x0, TILE_TOP_Y, z1, 0, 0, 1, u)
        const d = pushVert(x1, TILE_TOP_Y, z1, 0, 0, 1, u)
        pushQuad(a, b, c, d)
      }
      // -X
      {
        const a = pushVert(x0, TILE_BOT_Y, z1, -1, 0, 0, u)
        const b = pushVert(x0, TILE_BOT_Y, z0, -1, 0, 0, u)
        const c = pushVert(x0, TILE_TOP_Y, z0, -1, 0, 0, u)
        const d = pushVert(x0, TILE_TOP_Y, z1, -1, 0, 0, u)
        pushQuad(a, b, c, d)
      }
      // +X
      {
        const a = pushVert(x1, TILE_BOT_Y, z0, 1, 0, 0, u)
        const b = pushVert(x1, TILE_BOT_Y, z1, 1, 0, 0, u)
        const c = pushVert(x1, TILE_TOP_Y, z1, 1, 0, 0, u)
        const d = pushVert(x1, TILE_TOP_Y, z0, 1, 0, 0, u)
        pushQuad(a, b, c, d)
      }
    }
  }
  boardMeshRaw.positions = new Float32Array(pos)
  boardMeshRaw.normals = new Float32Array(nrm)
  boardMeshRaw.uvs = new Float32Array(uvs)
  boardMeshRaw.indices = new Uint32Array(idx)
  console.log('filled', 32, 'start-rank board tiles (full thickness)')
}

const playBox = new THREE.Box3()
for (let i = 0; i < boardMeshRaw.positions.length; i += 3) {
  playBox.expandByPoint(
    new THREE.Vector3(
      boardMeshRaw.positions[i],
      boardMeshRaw.positions[i + 1],
      boardMeshRaw.positions[i + 2],
    ),
  )
}
const boardMesh = recenter(boardMeshRaw, 'board', playBox)
await writeMeshGlb({
  ...boardMesh,
  imageBytes,
  mimeType,
  outPath: path.join(rootDir, 'public/assets/boards/chessset/model.glb'),
})

const pieceSpecs = [
  // white
  ...BACK_RANK.map((kind, file) => ({
    kind,
    color: 'w',
    file,
    rank: 0,
  })),
  { kind: 'pawn', color: 'w', file: 0, rank: 1 },
  // black — model has the heavier mesh on d-file; treat as king
  { kind: 'rook', color: 'b', file: 0, rank: 7 },
  { kind: 'knight', color: 'b', file: 1, rank: 7 },
  { kind: 'bishop', color: 'b', file: 2, rank: 7 },
  { kind: 'king', color: 'b', file: 3, rank: 7 },
  { kind: 'queen', color: 'b', file: 4, rank: 7 },
  { kind: 'bishop', color: 'b', file: 5, rank: 7 },
  { kind: 'knight', color: 'b', file: 6, rank: 7 },
  { kind: 'rook', color: 'b', file: 7, rank: 7 },
  { kind: 'pawn', color: 'b', file: 0, rank: 6 },
]

const pieceDir = path.join(rootDir, 'public/assets/pieces/chessset')
const written = new Set()
for (const spec of pieceSpecs) {
  const outName = `${spec.kind}-${spec.color}.glb`
  if (written.has(outName)) continue
  const key = `${spec.file},${spec.rank}`
  const tris = pieceTris.get(key)
  if (!tris?.length) throw new Error(`No triangles for ${key} (${outName})`)
  const raw = extractTriangles(tris, worldVerts, worldNormals, srcUv, srcIndices)
  const box = new THREE.Box3()
  for (let i = 0; i < raw.positions.length; i += 3) {
    box.expandByPoint(
      new THREE.Vector3(raw.positions[i], raw.positions[i + 1], raw.positions[i + 2]),
    )
  }
  // Scale pieces with the same S as the board so they match square size.
  const S = boardMesh.S
  const center = box.getCenter(new THREE.Vector3())
  const bottomY = box.min.y
  const positions = new Float32Array(raw.positions.length)
  for (let i = 0; i < raw.positions.length; i += 3) {
    positions[i] = (raw.positions[i] - center.x) * S
    positions[i + 1] = (raw.positions[i + 1] - bottomY) * S
    positions[i + 2] = (raw.positions[i + 2] - center.z) * S
  }
  await writeMeshGlb({
    positions,
    normals: raw.normals,
    uvs: raw.uvs,
    indices: raw.indices,
    imageBytes,
    mimeType,
    outPath: path.join(pieceDir, outName),
  })
  written.add(outName)
  console.log(
    '  piece',
    outName,
    'tris',
    tris.length,
    'h',
    +((box.max.y - box.min.y) * S).toFixed(3),
  )
}

console.log('done', { boardTris: boardTris.length, pieces: written.size, S: boardMesh.S })
