import { createClient, type Client } from '@libsql/client'
import fs from 'node:fs'
import path from 'node:path'

let client: Client | null = null

function resolveEnv() {
  return {
    url: process.env.TURSO_DATABASE_URL || '',
    authToken:
      process.env.TURSO_AUTH_TOKEN ||
      process.env.TURSO_DATABASE_TURSO_AUTH_TOKEN ||
      '',
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

  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error(
      'TURSO_DATABASE_URL and a Turso auth token are required in production',
    )
  }

  const dir = path.join(process.cwd(), '.data')
  fs.mkdirSync(dir, { recursive: true })
  const fileUrl = `file:${path.join(dir, 'opening-cards.db')}`
  client = createClient({ url: fileUrl })
  return client
}
