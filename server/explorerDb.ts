import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { getTurso } from './turso.js'

let client: Client | null = null

/**
 * Explorer counts live in a local SQLite file when that file is present.
 * Opening cards stay on Turso. Set EXPLORER_DATABASE_PATH to point elsewhere.
 */
export function explorerDatabasePath(root = process.cwd()): string {
  const configured = process.env.EXPLORER_DATABASE_PATH
  if (configured) return path.resolve(configured)
  const unlimitedDir = path.join(root, '.data', 'run-2026-09-all')
  const unlimited = path.join(unlimitedDir, 'explorer-2026-09.sqlite')
  if (existsSync(path.join(unlimitedDir, 'READY')) && existsSync(unlimited)) return unlimited
  return path.join(root, '.data', 'explorer-2026-09.sqlite')
}

export function getExplorerDb(): Client {
  if (client) return client
  const file = explorerDatabasePath()
  if (existsSync(file)) {
    client = createClient({ url: `file:${file}` })
    return client
  }
  return getTurso()
}

export type ExplorerSource = {
  /** `YYYY-MM` stamped on every row in that file. */
  month: string
  db: Client
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

let sourcesPromise: Promise<ExplorerSource[]> | null = null

/**
 * Months the explorer can filter. The live file is one month. Other finished
 * months live in their own sqlite files under `.data/`. Each file keeps its
 * own connection. A second file is skipped when it repeats the live month, so
 * a rebuild copy cannot double-count September.
 */
export function listExplorerSources(): Promise<ExplorerSource[]> {
  if (!sourcesPromise) sourcesPromise = loadExplorerSources()
  return sourcesPromise
}

async function loadExplorerSources(): Promise<ExplorerSource[]> {
  const file = explorerDatabasePath()
  if (!existsSync(file)) return []
  const db = getExplorerDb()
  const primary = await readPrimaryMonth(db)
  const sources: ExplorerSource[] = []
  if (primary) sources.push({ month: primary, db })
  for (const extra of extraMonthFiles(primary)) {
    sources.push({
      month: extra.month,
      db: createClient({ url: `file:${extra.file}` }),
    })
  }
  sources.sort((a, b) => a.month.localeCompare(b.month))
  return sources
}

async function readPrimaryMonth(db: Client): Promise<string | null> {
  try {
    const info = await db.execute("SELECT name FROM pragma_table_info('explorer_move')")
    const hasMonth = info.rows.some((row) => String(row.name ?? '') === 'month')
    if (!hasMonth) return null
    const result = await db.execute('SELECT month FROM explorer_move LIMIT 1')
    const month = String(result.rows[0]?.month ?? '')
    return MONTH_RE.test(month) ? month : null
  } catch {
    return null
  }
}

function extraMonthFiles(primary: string | null): { month: string; file: string }[] {
  const data = path.join(process.cwd(), '.data')
  if (!existsSync(data)) return []
  const found = new Map<string, string>()
  for (const entry of readdirSync(data, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(data, entry.name)
    const sidePath = path.join(dir, 'explorer-month.txt')
    if (!existsSync(sidePath)) continue
    const month = readFileSync(sidePath, 'utf8').trim()
    if (!MONTH_RE.test(month) || month === primary || found.has(month)) continue
    const sqlite = readdirSync(dir).find((name) => name.endsWith('.sqlite'))
    if (!sqlite) continue
    found.set(month, path.join(dir, sqlite))
  }
  return [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, file]) => ({ month, file }))
}
