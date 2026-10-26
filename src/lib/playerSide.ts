/** White or Black as this app stores it on an imported game. */
export type PlayerSide = 'white' | 'black'

const SIDE_HEADER = /\[PlayerColor\s+"(white|black)"\]/i

/** Lowercase, trim, and drop a leading @ so "Hikaru" matches "hikaru". */
export function normalizeChessName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/^@/, '')
}

/**
 * Which side `username` played.
 * Exact match first, then a member URL or a title prefix ("GM hikaru").
 * Returns null when the name is not in the game — callers must not invent White.
 */
export function sideForUsername(
  whiteName: string | null | undefined,
  blackName: string | null | undefined,
  username: string | null | undefined,
): PlayerSide | null {
  const user = normalizeChessName(username)
  if (!user) return null
  const white = normalizeChessName(whiteName)
  const black = normalizeChessName(blackName)
  if (white === user) return 'white'
  if (black === user) return 'black'
  const loose = (name: string) =>
    name.endsWith('/' + user) || name.endsWith(' ' + user)
  if (white && loose(white)) return 'white'
  if (black && loose(black)) return 'black'
  return null
}

/** Read the side we saved into the PGN. Null when this game never recorded one. */
export function readPlayerColorHeader(pgn: string): PlayerSide | null {
  const match = pgn.match(SIDE_HEADER)
  if (!match) return null
  return match[1].toLowerCase() === 'black' ? 'black' : 'white'
}

/**
 * Words the review coach must follow.
 * The live "side to move" rule talks as White whenever White is about to move,
 * which is the usual end of a game the human played as Black.
 */
export function reviewCoachVoice(color: PlayerSide): string {
  const you = color === 'white' ? 'White' : 'Black'
  const opp = color === 'white' ? 'Black' : 'White'
  return [
    `The human played ${you} in this imported game. Speak as “you” to ${you} only.`,
    `Do not talk as if the human played ${opp}.`,
    `Call ${opp} the opponent (“they”), never “you”.`,
    `If ${opp} is the side to move right now, explain what ${you} is facing. Do not coach ${opp} as “you”.`,
  ].join(' ')
}
