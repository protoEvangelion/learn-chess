/**
 * R3F v9 constructs `THREE.Clock` (deprecated in three ≥ r183). ESM exports
 * are read-only, so we can't replace `THREE.Clock`. Until R3F v10, suppress
 * only that known library warning (and keep a local Clock-compatible helper
 * unused — shadows are fixed via Canvas `PCFShadowMap`).
 */
const PREFIXES = [
  'THREE.Clock: This module has been deprecated',
  'THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated',
]

const originalWarn = console.warn.bind(console)
console.warn = (...args: unknown[]) => {
  const first = args[0]
  const text =
    typeof first === 'string'
      ? first
      : first != null && typeof (first as { toString?: () => string }).toString === 'function'
        ? String(first)
        : ''
  if (PREFIXES.some((p) => text.includes(p))) return
  originalWarn(...args)
}
