const USER_RE = /^[a-z0-9_-]{2,25}$/i

type ArchiveGame = {
  pgn?: string
  end_time?: number
}

function usernameOrThrow(username: string): string {
  const trimmed = username.trim()
  const user = trimmed.toLowerCase()
  if (!user || !USER_RE.test(trimmed)) {
    throw new Error('Enter a chess.com username')
  }
  return user
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.name === 'TypeError' || err.name === 'AbortError') return true
  return (
    err.message === 'Failed to fetch' ||
    err.message === 'fetch failed' ||
    err.message === 'Load failed' ||
    err.message === 'NetworkError when attempting to fetch resource.'
  )
}

/** Latest finished game, read from chess.com's public API in the browser. */
export async function fetchLatestChessComPgn(username: string): Promise<string> {
  const user = usernameOrThrow(username)
  const archivesRes = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`,
  )
  if (archivesRes.status === 404) {
    throw new Error('No chess.com player with that username')
  }
  if (!archivesRes.ok) {
    throw new Error(`Chess.com returned ${archivesRes.status}`)
  }
  const archivesBody = (await archivesRes.json()) as { archives?: string[] }
  const archives = archivesBody.archives ?? []
  if (archives.length === 0) {
    throw new Error('No chess.com games for that username')
  }

  let lastErr: Error | null = null
  const start = archives.length - 1
  const stop = Math.max(0, archives.length - 3)
  for (let i = start; i >= stop; i--) {
    try {
      const monthRes = await fetch(archives[i])
      if (!monthRes.ok) {
        lastErr = new Error(`Chess.com returned ${monthRes.status}`)
        continue
      }
      const month = (await monthRes.json()) as { games?: ArchiveGame[] }
      let best: { pgn: string; endTime: number } | null = null
      for (const game of month.games ?? []) {
        const pgn = game.pgn?.trim()
        if (!pgn) continue
        const endTime = game.end_time ?? 0
        if (!best || endTime >= best.endTime) best = { pgn, endTime }
      }
      if (best) return best.pgn
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
    }
  }

  throw (
    lastErr ?? new Error('No recent chess.com games for that username')
  )
}

async function readApiBody(res: Response): Promise<{ pgn?: string; error?: string }> {
  const text = await res.text()
  if (!text.trim()) throw new Error(`Import failed (${res.status})`)
  try {
    return JSON.parse(text) as { pgn?: string; error?: string }
  } catch {
    throw new Error(`Import failed (${res.status})`)
  }
}

async function pgnFromOurApi(username: string): Promise<string> {
  const res = await fetch('/api/import-chesscom-latest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim() }),
  })
  const data = await readApiBody(res)
  if (!res.ok || !data.pgn) {
    throw new Error(data.error || `Import failed (${res.status})`)
  }
  return data.pgn
}

/**
 * Ask our server first. If that call dies with "Failed to fetch", or the
 * server could not get the game, read chess.com's public archive in the browser.
 * Chess.com allows that from a normal browser (Access-Control-Allow-Origin: *).
 */
export async function loadLatestChessComPgn(username: string): Promise<string> {
  usernameOrThrow(username)
  let last: Error | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await pgnFromOurApi(username)
    } catch (err) {
      last = err instanceof Error ? err : new Error('Import failed')
      if (!isNetworkError(err)) break
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
    }
  }

  try {
    return await fetchLatestChessComPgn(username)
  } catch (directErr) {
    if (last && !isNetworkError(last)) throw last
    if (directErr instanceof Error && !isNetworkError(directErr)) throw directErr
    throw new Error('Could not reach chess.com to load your latest game. Try again.')
  }
}
