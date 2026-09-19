/**
 * Generate curated board / room / low-poly piece GLBs + short WAV sfx.
 * Run: node scripts/generate-assets.mjs
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Blob } from 'node:buffer'

/** GLTFExporter needs FileReader in Node. */
class NodeFileReader {
  result = null
  onloadend = null
  readAsArrayBuffer(blob) {
    blob
      .arrayBuffer()
      .then((buf) => {
        this.result = buf
        this.onloadend?.({ target: this })
      })
      .catch((err) => {
        throw err
      })
  }
}
globalThis.FileReader = NodeFileReader
globalThis.Blob = Blob

const root = path.dirname(fileURLToPath(import.meta.url))
const pub = path.join(root, '..', 'public')

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function exportGlb(object, outPath) {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter()
    exporter.parse(
      object,
      (result) => {
        fs.writeFileSync(outPath, Buffer.from(result))
        console.log('wrote', outPath)
        resolve()
      },
      (err) => reject(err),
      { binary: true },
    )
  })
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.05,
    ...opts,
  })
}

/** Wooden board: 8×8 playable plane centered at origin, top at y=0, rim with coords feel. */
async function makeBoard() {
  const group = new THREE.Group()
  group.name = 'WoodBoard'

  const light = mat(0xd4b896, { roughness: 0.7 })
  const dark = mat(0x6b4423, { roughness: 0.75 })
  const rimMat = mat(0x4a2f1a, { roughness: 0.65 })

  // Playable squares: centers at (i-3.5, 0, j-3.5), top face at y=0
  for (let z = 0; z < 8; z++) {
    for (let x = 0; x < 8; x++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.98, 0.18, 0.98),
        (x + z) % 2 === 0 ? light : dark,
      )
      mesh.position.set(x - 3.5, -0.09, z - 3.5)
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
    }
  }

  // Rim frame
  const rimH = 0.22
  const rimY = -0.2
  const outer = 9.2
  const inner = 8.05
  const thickness = (outer - inner) / 2
  const frames = [
    [0, rimY, -(inner / 2 + thickness / 2), outer, rimH, thickness],
    [0, rimY, inner / 2 + thickness / 2, outer, rimH, thickness],
    [-(inner / 2 + thickness / 2), rimY, 0, thickness, rimH, inner],
    [inner / 2 + thickness / 2, rimY, 0, thickness, rimH, inner],
  ]
  for (const [x, y, z, w, h, d] of frames) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rimMat)
    m.position.set(x, y, z)
    m.receiveShadow = true
    m.castShadow = true
    group.add(m)
  }

  // Base slab
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(9.4, 0.35, 9.4),
    mat(0x3a2414, { roughness: 0.8 }),
  )
  base.position.set(0, -0.42, 0)
  base.receiveShadow = true
  group.add(base)

  const out = path.join(pub, 'assets/boards/wood/model.glb')
  ensureDir(path.dirname(out))
  await exportGlb(group, out)
}

/** Studio room: floor + table + simple walls (board sits on table at y≈0). */
async function makeRoom() {
  const group = new THREE.Group()
  group.name = 'StudioRoom'

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(40, 0.4, 40),
    mat(0x1a1614, { roughness: 0.9 }),
  )
  floor.position.set(0, -2.2, 0)
  floor.receiveShadow = true
  group.add(floor)

  // Table top — board sits roughly on y=0 of world when boardAnchor lifts
  const tableTop = new THREE.Mesh(
    new THREE.BoxGeometry(14, 0.35, 14),
    mat(0x5c3d2e, { roughness: 0.55 }),
  )
  tableTop.position.set(0, -0.85, 0)
  tableTop.receiveShadow = true
  tableTop.castShadow = true
  group.add(tableTop)

  const legMat = mat(0x3d2818, { roughness: 0.7 })
  for (const [x, z] of [
    [-5.5, -5.5],
    [5.5, -5.5],
    [-5.5, 5.5],
    [5.5, 5.5],
  ]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.4, 0.55), legMat)
    leg.position.set(x, -1.7, z)
    leg.castShadow = true
    group.add(leg)
  }

  const wallMat = mat(0x2a2420, { roughness: 0.95, metalness: 0 })
  const back = new THREE.Mesh(new THREE.BoxGeometry(40, 16, 0.4), wallMat)
  back.position.set(0, 4, -18)
  group.add(back)
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.4, 16, 36), wallMat)
  left.position.set(-18, 4, 0)
  group.add(left)
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.4, 16, 36), wallMat)
  right.position.set(18, 4, 0)
  group.add(right)

  // Soft ceiling strip
  const ceil = new THREE.Mesh(
    new THREE.BoxGeometry(36, 0.3, 36),
    mat(0x12100e, { roughness: 1 }),
  )
  ceil.position.set(0, 11, 0)
  group.add(ceil)

  const out = path.join(pub, 'assets/rooms/studio/model.glb')
  ensureDir(path.dirname(out))
  await exportGlb(group, out)
}

/** Low-poly geometric piece; origin at bottom center. Named mesh for useGLTF. */
function buildPiece(kind) {
  const g = new THREE.Group()
  g.name = kind
  const body = mat(0xcccccc, { roughness: 0.4, metalness: 0.15 })

  const add = (geo, y, sy = 1) => {
    const m = new THREE.Mesh(geo, body)
    m.name = kind
    m.position.y = y
    m.scale.y = sy
    g.add(m)
  }

  switch (kind) {
    case 'pawn':
      add(new THREE.CylinderGeometry(0.28, 0.38, 0.2, 8), 0.1)
      add(new THREE.CylinderGeometry(0.22, 0.28, 0.55, 8), 0.5)
      add(new THREE.SphereGeometry(0.26, 10, 8), 0.95)
      break
    case 'rook':
      add(new THREE.CylinderGeometry(0.35, 0.42, 0.22, 8), 0.11)
      add(new THREE.BoxGeometry(0.55, 0.85, 0.55), 0.65)
      add(new THREE.BoxGeometry(0.7, 0.22, 0.7), 1.15)
      break
    case 'knight':
      add(new THREE.CylinderGeometry(0.32, 0.4, 0.2, 8), 0.1)
      add(new THREE.BoxGeometry(0.4, 0.7, 0.55), 0.55)
      add(new THREE.BoxGeometry(0.35, 0.35, 0.7), 1.0)
      break
    case 'bishop':
      add(new THREE.CylinderGeometry(0.3, 0.4, 0.2, 8), 0.1)
      add(new THREE.ConeGeometry(0.32, 1.0, 8), 0.75)
      add(new THREE.SphereGeometry(0.14, 8, 8), 1.35)
      break
    case 'queen':
      add(new THREE.CylinderGeometry(0.35, 0.45, 0.22, 8), 0.11)
      add(new THREE.CylinderGeometry(0.28, 0.35, 0.95, 8), 0.7)
      add(new THREE.SphereGeometry(0.22, 10, 8), 1.35)
      add(new THREE.ConeGeometry(0.12, 0.28, 6), 1.6)
      break
    case 'king':
      add(new THREE.CylinderGeometry(0.35, 0.45, 0.22, 8), 0.11)
      add(new THREE.CylinderGeometry(0.3, 0.36, 1.05, 8), 0.75)
      add(new THREE.BoxGeometry(0.55, 0.18, 0.55), 1.4)
      add(new THREE.BoxGeometry(0.14, 0.4, 0.14), 1.7)
      add(new THREE.BoxGeometry(0.35, 0.14, 0.14), 1.7)
      break
    default:
      break
  }

  // Flatten to single mesh for simpler useGLTF node lookup
  const geos = []
  g.updateMatrixWorld(true)
  g.traverse((c) => {
    if (c.isMesh) {
      const geo = c.geometry.clone()
      c.updateWorldMatrix(true, false)
      geo.applyMatrix4(c.matrixWorld)
      geos.push(geo)
    }
  })
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos)
  const mesh = new THREE.Mesh(merged, body)
  mesh.name = kind
  const out = new THREE.Group()
  out.add(mesh)
  return out
}

function mergeGeometries(geometries) {
  // Minimal merge without BufferGeometryUtils dependency
  const { mergeGeometries: merge } = requireMerge()
  return merge(geometries, false)
}

function requireMerge() {
  // dynamic import sync via already-loaded three addon
  return {
    mergeGeometries: (geos) => {
      // Fallback: use first geometry only if merge fails — load addon
      return geos[0]
    },
  }
}

async function makePieces() {
  const { mergeGeometries } = await import(
    'three/addons/utils/BufferGeometryUtils.js'
  )
  const dir = path.join(pub, 'assets/pieces/lowpoly')
  ensureDir(dir)

  for (const kind of ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king']) {
    const g = new THREE.Group()
    const body = mat(0xdddddd, { roughness: 0.45, metalness: 0.2 })
    const piece = buildPiece(kind)
    // rebuild with real merge
    const geos = []
    piece.updateMatrixWorld(true)
    piece.traverse((c) => {
      if (c.isMesh) {
        const geo = c.geometry.clone()
        c.updateWorldMatrix(true, false)
        geo.applyMatrix4(c.matrixWorld)
        geos.push(geo)
      }
    })
    const merged = mergeGeometries(geos, false)
    const mesh = new THREE.Mesh(merged, body)
    mesh.name = kind
    g.add(mesh)
    // Scale so piece height roughly matches classic set (~1 local after 0.15 * 0.03 mesh... classic is weird)
    // Classic: MeshWrapper scale 0.15, mesh scale 0.03 → world ~ piece size in gltf units * 0.0045
    // Lowpoly built in ~1.5 unit height; we want similar board footprint.
    // Place pieces with scale ~0.55 in MeshWrapper for lowpoly (handled in catalog).
    await exportGlb(g, path.join(dir, `${kind}.glb`))
  }
}

function writeWav(filePath, samples, sampleRate = 22050) {
  const numChannels = 1
  const bitsPerSample = 16
  const blockAlign = (numChannels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE((s * 32767) | 0, 44 + i * 2)
  }
  fs.writeFileSync(filePath, buffer)
  console.log('wrote', filePath)
}

/** Deterministic 0..1 noise (reproducible CC0 synth). */
function hashNoise(i, seed = 1) {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Soft wooden board tap — chess.com-like: short, quiet, muted.
 * Transient tick + damped wood body + faint board thump.
 */
function woodTap(sr, {
  duration = 0.07,
  bodyHz = 320,
  tickHz = 1900,
  thumpHz = 95,
  gain = 0.16,
  seed = 1,
  secondTapAt = null,
  secondGain = 0.7,
} = {}) {
  const n = Math.floor(sr * duration)
  const s = new Float32Array(n)
  const paint = (offset, scale) => {
    for (let i = 0; i < n; i++) {
      const t = i / sr
      if (t < offset) continue
      const u = t - offset
      const tickEnv = Math.exp(-u * 140)
      const bodyEnv = Math.exp(-u * 48)
      const thumpEnv = Math.exp(-u * 28)
      const noise = (hashNoise(i, seed) * 2 - 1) * tickEnv * 0.35
      const tick = Math.sin(2 * Math.PI * tickHz * u) * tickEnv * 0.22
      const body =
        Math.sin(2 * Math.PI * bodyHz * u) * bodyEnv * 0.55 +
        Math.sin(2 * Math.PI * bodyHz * 1.55 * u) * bodyEnv * 0.18
      const thump = Math.sin(2 * Math.PI * thumpHz * u) * thumpEnv * 0.28
      s[i] += (noise + tick + body + thump) * gain * scale
    }
  }
  paint(0, 1)
  if (secondTapAt != null) paint(secondTapAt, secondGain)
  // Soft peak normalize so clips stay subtle and consistent.
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(s[i]))
  if (peak > 0.22) {
    const k = 0.22 / peak
    for (let i = 0; i < n; i++) s[i] *= k
  }
  return s
}

function makeSfx() {
  const dir = path.join(pub, 'sfx')
  ensureDir(dir)
  const sr = 44100

  // move: single soft wood place
  writeWav(
    path.join(dir, 'move.wav'),
    woodTap(sr, {
      duration: 0.065,
      bodyHz: 340,
      tickHz: 2100,
      gain: 0.14,
      seed: 11,
    }),
    sr,
  )

  // capture: quiet double tap (piece takes piece)
  writeWav(
    path.join(dir, 'capture.wav'),
    woodTap(sr, {
      duration: 0.14,
      bodyHz: 280,
      tickHz: 1650,
      thumpHz: 78,
      gain: 0.17,
      seed: 29,
      secondTapAt: 0.038,
      secondGain: 0.85,
    }),
    sr,
  )

  // check: soft wood + brief muted chime (not an alarm)
  {
    const tap = woodTap(sr, {
      duration: 0.16,
      bodyHz: 360,
      tickHz: 2400,
      gain: 0.12,
      seed: 47,
    })
    const n = tap.length
    for (let i = 0; i < n; i++) {
      const t = i / sr
      const env = Math.exp(-t * 14)
      const chime =
        Math.sin(2 * Math.PI * 880 * t) * 0.045 * env +
        Math.sin(2 * Math.PI * 1320 * t) * 0.028 * env
      tap[i] += chime
    }
    writeWav(path.join(dir, 'check.wav'), tap, sr)
  }

  // gameOver: soft descending muted tones
  {
    const n = Math.floor(sr * 0.55)
    const s = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / sr
      const env = Math.exp(-t * 3.2)
      const f1 = 392 - t * 90
      const f2 = 311 - t * 70
      s[i] =
        (Math.sin(2 * Math.PI * f1 * t) * 0.1 +
          Math.sin(2 * Math.PI * f2 * t) * 0.07) *
        env
    }
    writeWav(path.join(dir, 'gameOver.wav'), s, sr)
  }

  fs.writeFileSync(
    path.join(dir, 'README.md'),
    [
      '# Board SFX (CC0)',
      '',
      'Synthesized soft wood taps for move / capture / check / game-over.',
      'Generated by `scripts/generate-assets.mjs` — public domain (CC0).',
      'Tuned to stay quiet and brief, similar in feel to chess.com board sounds.',
      '',
    ].join('\n'),
  )
}

if (process.argv.includes('--sfx-only')) {
  makeSfx()
} else {
  await makeBoard()
  makeSfx()
}
console.log('done')
