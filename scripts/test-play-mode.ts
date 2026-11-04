/**
 * Who may move, and when the computer answers.
 * Run: npx tsx --tsconfig tsconfig.app.json scripts/test-play-mode.ts
 */
import { parsePgnToImportedGame } from '../src/lib/pgnImport'
import {
  computerShouldReply,
  pgnLoadsAsPlayableLine,
  userMovesEitherSide,
} from '../src/lib/playMode'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

const explorePgn = `[White "?"]
[Black "?"]
[Result "*"]
[PlayerColor "white"]

1. e4 *`

{
  const game = parsePgnToImportedGame(explorePgn)
  assert(game.turn === 'black', `after 1. e4 black is to move (${game.turn})`)
  assert(game.playerColor === 'white', 'header keeps the seat as white')
  assert(game.history.length === 1, 'one ply was played')
}

assert(pgnLoadsAsPlayableLine('explore'), 'explore PGN is a line you can play')
assert(pgnLoadsAsPlayableLine('analysis'), 'analysis PGN is a line you can play')
assert(pgnLoadsAsPlayableLine('drill'), 'drill PGN is a line you can play')
assert(!pgnLoadsAsPlayableLine('my-games'), 'my games stays a locked review')
assert(!pgnLoadsAsPlayableLine('game'), 'a game link is not a browse line')
assert(!pgnLoadsAsPlayableLine(null), 'the open board is a live game')

assert(
  userMovesEitherSide({ panel: 'explore', reviewing: false }),
  'explore: move the side to move',
)
assert(
  userMovesEitherSide({ panel: 'analysis', reviewing: false }),
  'analysis: move the side to move',
)
assert(
  userMovesEitherSide({ panel: 'drill', reviewing: false }),
  'drill: move the side to move',
)
assert(
  !userMovesEitherSide({ panel: 'explore', reviewing: true }),
  'a review on the board stays locked',
)
assert(
  !userMovesEitherSide({ panel: null, reviewing: false }),
  'a live game only lets you move your color',
)
assert(
  !userMovesEitherSide({ panel: 'game', reviewing: false }),
  'game panel only lets you move your color',
)

const quiet = { reviewing: false, drillActive: false, gameOver: false }
assert(!computerShouldReply({ ...quiet, panel: 'explore' }), 'explore: no auto-reply')
assert(!computerShouldReply({ ...quiet, panel: 'analysis' }), 'analysis: no auto-reply')
assert(!computerShouldReply({ ...quiet, panel: 'drill' }), 'drill: no auto-reply')
assert(!computerShouldReply({ ...quiet, panel: 'my-games' }), 'my games: no auto-reply')
assert(
  !computerShouldReply({ ...quiet, panel: null, reviewing: true }),
  'loaded review: no auto-reply',
)
assert(
  !computerShouldReply({ ...quiet, panel: null, drillActive: true }),
  'active drill: no auto-reply',
)
assert(computerShouldReply({ ...quiet, panel: null }), 'open board: computer replies')
assert(computerShouldReply({ ...quiet, panel: 'game' }), 'game panel: computer replies')
assert(
  !computerShouldReply({ ...quiet, panel: 'game', gameOver: true }),
  'finished game: computer stays quiet',
)

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('play mode ok')
