/**
 * Service worker registration and standalone-mode helpers.
 *
 * The worker only exists in production builds (`vite-plugins/pwa.ts` writes
 * dist/sw.js), so dev keeps a clean, always-fresh cache.
 */
const INSTALL_HINT_KEY = 'chess-3d:installHintDismissed'

export function isIos(): boolean {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return true
  // iPadOS 13+ reports a desktop UA; touch points give it away.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

/** Running from the home screen, not a browser tab. */
export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone
  return iosStandalone === true || window.matchMedia('(display-mode: standalone)').matches
}

export function installHintDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_HINT_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissInstallHint() {
  try {
    localStorage.setItem(INSTALL_HINT_KEY, '1')
  } catch {
    // Private mode: the hint just shows again next launch.
  }
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  let reloading = false
  // First install also fires controllerchange (the worker claims the page).
  // Only a worker replacing an existing one should cost the user a reload.
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })

  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline-first is a bonus; the app works without it.
    })
  }

  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
