import { createClient, type Client } from '@libsql/client'
import { loadEnv } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

let client: Client | null = null

function resolveEnv() {
  const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development'
  const loaded = loadEnv(mode, process.cwd(), '')
  return {
    url: process.env.TURSO_DATABASE_URL || loaded.TURSO_DATABASE_URL || '',
    authToken: process.env.TURSO_AUTH_TOKEN || loaded.TURSO_AUTH_TOKEN || '',
  }
}

/** Turso remote when configured; otherwise local file DB under `.data/`. */
export function getTurso(): Client {
  if (client) return client

  const { url, authToken } = resolveEnv()
  if (url) {
    client = createClient({
      url,
      authToken: authToken || undefined,
    })
    return client
  }

  const dir = path.join(process.cwd(), '.data')
  fs.mkdirSync(dir, { recursive: true })
  const fileUrl = `file:${path.join(dir, 'opening-cards.db')}`
  client = createClient({ url: fileUrl })
  return client
}
