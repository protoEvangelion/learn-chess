import { createClient, type Client } from '@libsql/client'

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

/**
 * One client, always a remote Turso database.
 * Dev and prod are two databases. Which one you get is only the URL and token
 * in the environment: `.env.local` for this machine, Vercel Preview for the
 * same dev database, Vercel Production for the prod database.
 */
export function getTurso(): Client {
  if (client) return client

  const { url, authToken } = resolveEnv()
  if (!url || !authToken) {
    throw new Error(
      'Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. Local dev and Preview use the dev database. Production uses the prod database.',
    )
  }

  client = createClient({ url, authToken })
  return client
}
