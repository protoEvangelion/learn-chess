/**
 * Rasterize the PWA icon set and iOS launch screens from the brand knight.
 *
 * The only brand asset is the 256px knight on a white field (the same mark the
 * HUD draws inside its teal-to-magenta frame), so every surface here keeps the
 * white field: the OS masks the home-screen icon to its own shape, and the
 * launch screen floats the same mark as a rounded card on the app's launch
 * background. Nothing is recoloured or redrawn.
 *
 *   node scripts/build-pwa-icons.mjs
 *
 * Requires ffmpeg on PATH (sips cannot composite alpha).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'public/brand-knight.png')
const ICONS = path.join(ROOT, 'public/icons')
const SPLASH = path.join(ROOT, 'public/splash')
const LAUNCH_BG = '0x07010f'

function ffmpeg(args) {
  const out = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], {
    encoding: 'utf8',
  })
  if (out.status !== 0) {
    throw new Error(`ffmpeg failed: ${out.stderr || out.stdout}`)
  }
}

/** White field with the knight centered at `share` of the short side. */
function composeIcon({ width, height = width, share, out }) {
  const mark = Math.round(Math.min(width, height) * share)
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    `color=c=0xffffff:s=${width}x${height}`,
    '-i',
    SRC,
    '-filter_complex',
    `[1:v]scale=${mark}:${mark}:flags=lanczos[k];[0:v][k]overlay=(W-w)/2:(H-h)/2:format=auto`,
    '-frames:v',
    '1',
    out,
  ])
}

/**
 * Rounded white card, alpha from a corner-radius field — the shape BrandMark
 * clips its knight to, minus the gradient frame that would only read at 40px.
 */
function buildCard(size, radius, out) {
  const half = size / 2
  const inner = half - radius
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    `color=c=0xffffff:s=${size}x${size}`,
    '-vf',
    `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(hypot(max(0,abs(X-${half})-${inner}),max(0,abs(Y-${half})-${inner})),${radius}),255,0)'`,
    '-frames:v',
    '1',
    out,
  ])
}

fs.mkdirSync(ICONS, { recursive: true })
fs.mkdirSync(SPLASH, { recursive: true })
const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules/.cache-pwa-'))

// Master at 1024, then downscale so every icon samples the same source.
const master = path.join(tmp, 'master.png')
composeIcon({ width: 1024, share: 0.8, out: master })

for (const size of [512, 192]) {
  ffmpeg([
    '-i',
    master,
    '-vf',
    `scale=${size}:${size}:flags=lanczos`,
    '-frames:v',
    '1',
    path.join(ICONS, `icon-${size}.png`),
  ])
}

// Maskable: the mark must stay inside the 80% safe circle.
composeIcon({
  width: 512,
  share: 0.56,
  out: path.join(ICONS, 'icon-maskable-512.png'),
})

// iOS reads this one; it must be opaque and full-bleed (iOS applies its mask).
composeIcon({
  width: 180,
  share: 0.8,
  out: path.join(ICONS, 'apple-touch-icon.png'),
})

// Launch screen mark: the white card with the knight sitting inside it.
const card = path.join(tmp, 'card.png')
buildCard(1024, 184, card)
const mark = path.join(tmp, 'mark.png')
ffmpeg([
  '-i',
  card,
  '-i',
  SRC,
  '-filter_complex',
  '[1:v]scale=716:716:flags=lanczos[k];[0:v][k]overlay=154:154:format=auto',
  '-frames:v',
  '1',
  mark,
])

/** [width, height] in device pixels. Mirrors the media queries in index.html. */
const SPLASHES = [
  [1320, 2868],
  [1290, 2796],
  [1206, 2622],
  [1179, 2556],
  [1170, 2532],
  [1284, 2778],
  [1242, 2688],
  [1125, 2436],
  [828, 1792],
  [750, 1334],
  [2048, 2732],
  [2732, 2048],
  [1668, 2388],
  [2388, 1668],
  [1640, 2360],
  [2360, 1640],
  [1536, 2048],
  [2048, 1536],
]

for (const [width, height] of SPLASHES) {
  const cardSize = Math.round(Math.min(width, height) * 0.2)
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    `color=c=${LAUNCH_BG}:s=${width}x${height}`,
    '-i',
    mark,
    '-filter_complex',
    `[1:v]scale=${cardSize}:${cardSize}:flags=lanczos[c];[0:v][c]overlay=(W-w)/2:(H-h)/2:format=auto`,
    '-frames:v',
    '1',
    path.join(SPLASH, `splash-${width}x${height}.png`),
  ])
}

fs.rmSync(tmp, { recursive: true, force: true })

console.log(
  `wrote public/icons (4 files) and public/splash (${SPLASHES.length} launch screens)`,
)
