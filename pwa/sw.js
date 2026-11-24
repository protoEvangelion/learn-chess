/*
 * Service worker source. `vite-plugins/pwa.ts` fills in the build version and
 * the precache list at build time and writes dist/sw.js. Edit this file, not
 * dist. Do not write the placeholder tokens in prose here: the build replaces
 * every occurrence.
 *
 * Strategy:
 *   - app shell + first-paint assets are precached (about 1 MB: JS, CSS,
 *     fonts, 2D piece sprites, sound, icons)
 *   - /api/* is never cached: the coach and explorer answers must be live
 *   - navigations are network-first with the cached shell as the offline fallback
 *   - hashed build output is cache-first (immutable by name)
 *   - everything else same-origin is stale-while-revalidate, capped, so the
 *     heavy 3D assets (gltf/hdr/wasm) are cached only once something asks for them
 */
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__

const SHELL_CACHE = `chess3d-shell-${VERSION}`
const ASSET_CACHE = 'chess3d-assets'
const MAX_ASSET_ENTRIES = 160
/** Skip single responses above this: iOS storage quotas are per-installed-app. */
const MAX_ASSET_BYTES = 8 * 1024 * 1024
const SHELL_URL = '/'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // One failed URL must not block the update: add what we can.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {}),
        ),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE])
      const names = await caches.keys()
      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

async function trimAssets() {
  const cache = await caches.open(ASSET_CACHE)
  const keys = await cache.keys()
  if (keys.length <= MAX_ASSET_ENTRIES) return
  await Promise.all(
    keys.slice(0, keys.length - MAX_ASSET_ENTRIES).map((key) => cache.delete(key)),
  )
}

function storeable(response) {
  if (!response || !response.ok || response.type !== 'basic') return false
  const length = Number(response.headers.get('content-length') ?? 0)
  return !(length > MAX_ASSET_BYTES)
}

async function put(cacheName, request, response) {
  const cache = await caches.open(cacheName)
  await cache.put(request, response)
}

async function networkFirstShell(request) {
  const shell = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (storeable(response)) await shell.put(SHELL_URL, response.clone())
    return response
  } catch {
    return (await shell.match(SHELL_URL)) ?? (await shell.match('/index.html')) ?? Response.error()
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (storeable(response)) {
    await put(ASSET_CACHE, request, response.clone())
    await trimAssets()
  }
  return response
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request)
  const network = fetch(request)
    .then(async (response) => {
      if (storeable(response)) {
        await put(ASSET_CACHE, request, response.clone())
        await trimAssets()
      }
      return response
    })
    .catch(() => null)
  return cached ?? (await network) ?? Response.error()
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname === '/sw.js') return
  // Live data: the coach, the explorer, the opening cards.
  if (url.pathname.startsWith('/api/')) return
  // Range requests (audio seeking) must reach the network untouched.
  if (request.headers.has('range')) return
  // iOS reads these itself at launch; the worker never needs them.
  if (url.pathname.startsWith('/splash/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request))
    return
  }
  if (url.pathname.startsWith('/assets/') && /-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request))
    return
  }
  event.respondWith(staleWhileRevalidate(request))
})
