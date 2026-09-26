import { Chess } from 'chess.js'

export type FrequencyArrow = {
  from: string
  to: string
  /** 0–1. Moves played more often are more opaque. */
  opacity: number
}

/** Next-move arrows for the position after `prefix`, opacity scaled by how often each move appeared. */
export function arrowsForReplies(
  prefix: string[],
  moves: Array<{ san: string; count: number }>,
): FrequencyArrow[] {
  if (moves.length === 0) return []
  const chess = new Chess()
  for (const san of prefix) {
    if (!chess.move(san)) return []
  }
  const max = Math.max(...moves.map((move) => move.count), 1)
  const arrows: FrequencyArrow[] = []
  for (const move of moves) {
    const probe = new Chess(chess.fen())
    const played = probe.move(move.san)
    if (!played) continue
    const ratio = move.count / max
    arrows.push({
      from: played.from,
      to: played.to,
      opacity: 0.22 + 0.73 * ratio,
    })
  }
  arrows.sort((a, b) => a.opacity - b.opacity)
  return arrows
}
