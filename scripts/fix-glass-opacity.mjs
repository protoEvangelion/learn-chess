/**
 * Make glass board/pieces GPU-cheap: opaque frosted look, no BLEND/transmission.
 * Run: node scripts/fix-glass-opacity.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import {
  KHRMaterialsTransmission,
  KHRMaterialsVolume,
  KHRMaterialsIOR,
} from '@gltf-transform/extensions'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const io = new NodeIO().registerExtensions([
  KHRMaterialsTransmission,
  KHRMaterialsVolume,
  KHRMaterialsIOR,
])

function patchMaterial(mat) {
  const name = (mat.getName() || '').toLowerCase()

  // Strip expensive glass extensions
  mat.setExtension('KHR_materials_transmission', null)
  mat.setExtension('KHR_materials_volume', null)
  mat.setExtension('KHR_materials_ior', null)

  if (name.includes('fogged') || name === 'glassfogged') {
    // Ruby / dark squares — solid frosted glass
    mat.setAlphaMode('OPAQUE')
    mat.setBaseColorFactor([0.42, 0.05, 0.08, 1])
    mat.setMetallicFactor(0.35)
    mat.setRoughnessFactor(0.18)
    mat.setDoubleSided(false)
    return 'fogged-opaque'
  }

  if (name === 'glass' || name.includes('glass')) {
    // Clear / light squares — frosted opaque
    mat.setAlphaMode('OPAQUE')
    mat.setBaseColorFactor([0.78, 0.84, 0.9, 1])
    mat.setMetallicFactor(0.45)
    mat.setRoughnessFactor(0.12)
    mat.setDoubleSided(false)
    return 'clear-opaque'
  }

  return null
}

async function patchFile(rel) {
  const file = path.join(root, rel)
  if (!fs.existsSync(file)) {
    console.warn('skip missing', rel)
    return
  }
  const doc = await io.read(file)
  const kinds = []
  for (const mat of doc.getRoot().listMaterials()) {
    const k = patchMaterial(mat)
    if (k) kinds.push(k)
  }
  // Drop unused transmission extension from the document if nothing uses it
  await io.write(file, doc)
  console.log('patched', rel, kinds.join(','))
}

const pieces = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king']
const files = [
  'public/assets/boards/glass/model.glb',
  ...pieces.flatMap((k) => [
    `public/assets/pieces/glass/${k}-w.glb`,
    `public/assets/pieces/glass/${k}-b.glb`,
  ]),
]

for (const f of files) await patchFile(f)
console.log('done')
