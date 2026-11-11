import type { PanelId } from '@/lib/fenBridge'

/**
 * Who plays the other side in a live game.
 * - `computer`: the person plays one color and Stockfish plays the other.
 * - `pvp`: two people share the board; both colors are played by hand.
 */
export type GameMode = 'computer' | 'pvp'

/**
 * Live game: the person plays one color and the computer plays the other.
 * That is the open board, the Game panel, and Settings (the game keeps going
 * behind the drawer).
 *
 * Browse / review: Analysis, Explore, Drill, My Games, and any loaded review.
 * The computer stays quiet. The person plays the side that is to move.
 */
export function computerShouldReply(input: {
  mode: GameMode
  panel: PanelId | null
  /** A saved game is on the board (My Games scrub). */
  reviewing: boolean
  /** Opening drill is in progress or just finished. */
  drillActive: boolean
  gameOver: boolean
}): boolean {
  if (input.mode === 'pvp') return false
  if (input.gameOver || input.reviewing || input.drillActive) return false
  if (isBrowsePanel(input.panel)) return false
  return true
}

/** Person can move White or Black, whichever side is to move. */
export function userMovesEitherSide(input: {
  mode: GameMode
  panel: PanelId | null
  reviewing: boolean
}): boolean {
  if (input.reviewing) return false
  if (input.mode === 'pvp') return true
  return isBrowsePanel(input.panel)
}

/**
 * A PGN opened in Explore, Analysis, or Drill is a position to play on,
 * not a locked game review. My Games keeps the review lock.
 */
export function pgnLoadsAsPlayableLine(panel: PanelId | null): boolean {
  return panel === 'explore' || panel === 'analysis' || panel === 'drill'
}

/**
 * Is a PGN in the URL a locked review, or a live game we saved?
 *
 * Our live-game PGNs only carry `[White "?"]` / `[Black "?"]` headers, so a
 * refresh must keep them playable. A real imported game has player names or a
 * saved `PlayerColor` header, and My Games is always a review.
 */
export function pgnIsReviewGame(pgn: string, panel: PanelId | null): boolean {
  if (pgnLoadsAsPlayableLine(panel)) return false
  if (panel === 'my-games') return true
  if (/\[PlayerColor\s+"/i.test(pgn)) return true
  const names = [...pgn.matchAll(/\[(?:White|Black)\s+"([^"]*)"/gi)]
    .map((match) => match[1].trim())
    .filter((name) => name && name !== '?')
  return names.length > 0
}

function isBrowsePanel(panel: PanelId | null): boolean {
  return (
    panel === 'analysis' ||
    panel === 'explore' ||
    panel === 'my-games' ||
    panel === 'drill' ||
    panel === 'coach'
  )
}
