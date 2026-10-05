import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const FILES = ['.env', '.env.local', '.env.development', '.env.development.local']

let loaded = false

/**
 * Vite only copies `VITE_*` into the dev server. Server secrets
 * (`LICHESS_API_TOKEN`, `AI_GATEWAY_API_KEY`, `VERCEL_OIDC_TOKEN`) live in
 * `.env` / `.env.local` and must be applied to `process.env` here.
 * Existing process env wins, so Vercel-injected values are left alone.
 */
export function loadServerEnv(root = process.cwd()): void {
  if (loaded) return
  loaded = true
  for (const name of FILES) {
    const file = path.join(root, name)
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const raw = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed
      const eq = raw.indexOf('=')
      if (eq <= 0) continue
      const key = raw.slice(0, eq).trim()
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
      if (process.env[key]) continue
      let value = raw.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}
