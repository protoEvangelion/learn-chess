/** Parse a UCI move like "e2e4" or "e7e8q" into board squares. */
export function uciToSquares(uci: string): { from: string; to: string } | null {
  const cleaned = uci.trim()
  if (cleaned.length < 4) return null
  const from = cleaned.slice(0, 2)
  const to = cleaned.slice(2, 4)
  if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) return null
  return { from, to }
}
