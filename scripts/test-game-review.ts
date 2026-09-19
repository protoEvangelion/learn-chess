/**
 * Smoke tests for post-game ply FEN timeline.
 * Run: npx vite-node scripts/test-game-review.ts
 */
import { copyBoard, createBoard } from '../src/logic/board'
import { buildPlyTimeline } from '../src/lib/gameReview'
import type { HistoryItem } from '../src/state/game'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

{
  const board = createBoard()
  const pawn = board[6][4].piece
  assert(!!pawn && pawn.type === 'pawn', 'starting e2 pawn exists')
  const item: HistoryItem = {
    board: copyBoard(board),
    from: { x: 4, y: 6 },
    to: { x: 4, y: 4 },
    capture: null,
    type: 'valid',
    steps: { x: 0, y: -2 },
    piece: pawn!,
  }
  const plies = buildPlyTimeline([item], 'white')
  assert(plies.length === 1, 'one ply')
  assert(plies[0].by === 'player', 'white player ply')
  assert(plies[0].san === 'e4', `san is e4, got ${plies[0].san}`)
  assert(plies[0].fen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'), 'start FEN before e4')
}

{
  const board = createBoard()
  const pawn = board[6][4].piece!
  const item: HistoryItem = {
    board: copyBoard(board),
    from: { x: 4, y: 6 },
    to: { x: 4, y: 4 },
    capture: null,
    type: 'valid',
    steps: { x: 0, y: -2 },
    piece: pawn,
  }
  const plies = buildPlyTimeline([item], 'black')
  assert(plies[0].by === 'opponent', 'e4 is opponent when playing black')
}

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nAll game-review timeline checks passed')
