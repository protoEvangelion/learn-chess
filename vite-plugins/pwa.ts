import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/**
 * Builds dist/sw.js from pwa/sw.js with a precache list and a content hash.
 *
 * Precache is deliberately small: the app shell, fonts, 2D piece sprites and
 * UI icons. The 3D side of the app is 100+ MB of gltf/hdr/wasm, so those are
 * left to the worker's runtime cache and only ever stored once something
 * actually asks for them.
 */
const PRECACHE_FILES = [
  'manifest.webmanifest',
  'favicon.svg',
  'icons.svg',
  'brand-knight.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
]

const PRECACHE_DIRS = [
  // Hashed build output: the app itself.
  { dir: 'assets', test: (name: string) => /\.(js|css|woff2)$/.test(name) },
  { dir: 'fonts', test: (name: string) => name.endsWith('.woff2') },
  { dir: 'sfx', test: (name: string) => name.endsWith('.mp3') },
  {
    dir: 'assets/pieces-2d',
    test: (name: string) => name.endsWith('.svg') || name.endsWith('.png'),
  },
]

function toUrl(relative: string) {
  return `/${relative.split(path.sep).join('/')}`
}

function walk(dir: string, root: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, root))
    else out.push(path.relative(root, full))
  }
  return out
}

export function pwaPlugin(): Plugin {
  let distDir = ''

  return {
    name: 'chess-pwa',
    apply: 'build',
    configResolved(config) {
      distDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const singles = PRECACHE_FILES.filter((file) => fs.existsSync(path.join(distDir, file)))
      const extras = PRECACHE_DIRS.flatMap(({ dir, test }) =>
        walk(path.join(distDir, dir), distDir).filter((file) => test(path.basename(file))),
      )
      const files = ['index.html', ...singles, ...extras]
        .map((file) => file.split(path.sep).join('/'))
        .filter((file) => fs.existsSync(path.join(distDir, file)))
        .sort()

      // '/' serves index.html and is the offline fallback, so precache it by name.
      const urls = ['/', ...files.map(toUrl)]

      const hash = crypto.createHash('sha1')
      for (const file of files) {
        hash.update(file)
        hash.update(fs.readFileSync(path.join(distDir, file)))
      }
      const version = hash.digest('hex').slice(0, 12)

      const template = fs.readFileSync(path.resolve(process.cwd(), 'pwa/sw.js'), 'utf8')
      const source = template
        .replaceAll('__VERSION__', () => version)
        .replaceAll('__PRECACHE__', () => JSON.stringify(urls, null, 2))

      fs.writeFileSync(path.join(distDir, 'sw.js'), source)
      this.info(
        `pwa: sw.js ${version} with ${urls.length} precached URLs (${files.length} files)`,
      )
    },
  }
}
