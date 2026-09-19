/**
 * Smoke tests for move safety preview logic.
 * Run: npx tsx scripts/test-move-preview.ts
 */
import { createBoard, createTestBoard } from '../src/logic/board'
import { movesForPiece } from '../src/logic/pieces'
import {
  iconsForPreview,
  pieceSafetyMap,
  previewByDestination,
  previewMove,
  protectedPieceKeys,
  threatenedPieceKeys,
  washColorForPreview,
} from '../src/logic/movePreview'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

// 1) Starting position — knight to a3 is safe blue-ish
{
  const board = createBoard()
  const knight = board[7][1].piece! // white knight b1
  const moves = movesForPiece({
    piece: knight,
    board,
    propagateDetectCheck: true,
  })
  const map = previewByDestination(board, moves)
  assert(map.size === moves.filter((m) => m.type === 'valid' || m.type === 'capture' || m.type === 'captureEnPassant' || m.type === 'castling').length, 'start: preview for each legal knight move')
  const a3 = map.get('0,5') // a3: x=0 y=5 (rank 3)
  // board y: 0=rank8 ... 7=rank1. a3 = file a (0), rank 3 → y = 8-3 = 5. Yes.
  assert(!!a3, 'start: has a3 preview')
  if (a3) {
    assert(!a3.destinationThreatened, 'Na3 not threatened on move 1')
    assert(washColorForPreview(a3) === '#5eb0ff' || washColorForPreview(a3) === '#6ec8d4', 'Na3 wash is safe blue/teal')
  }
}

// 2) Free take — white knight takes undefended black pawn
{
  const board = createTestBoard([
    { position: { x: 4, y: 7 }, piece: { color: 'white', id: 1, type: 'king' } },
    { position: { x: 4, y: 0 }, piece: { color: 'black', id: 1, type: 'king' } },
    { position: { x: 2, y: 5 }, piece: { color: 'white', id: 1, type: 'knight' } },
    { position: { x: 3, y: 3 }, piece: { color: 'black', id: 1, type: 'pawn' } },
  ])
  const knight = board[5][2].piece!
  const moves = movesForPiece({ piece: knight, board, propagateDetectCheck: true })
  const capture = moves.find(
    (m) => m.type === 'capture' && m.newPosition.x === 3 && m.newPosition.y === 3,
  )
  assert(!!capture, 'free-take: capture move exists')
  if (capture) {
    const p = previewMove(board, capture)
    assert(p.captureTrade?.label === 'free', `free-take label=${p.captureTrade?.label}`)
    assert(washColorForPreview(p) === '#2dd4bf' || p.destinationThreatened, 'free wash teal (unless also threatened)')
    assert(iconsForPreview(p).includes('free'), 'free icon present')
  }
}

// 3) Losing capture — Qxp guarded by knight
{
  const board = createTestBoard([
    { position: { x: 0, y: 7 }, piece: { color: 'white', id: 1, type: 'king' } },
    { position: { x: 7, y: 0 }, piece: { color: 'black', id: 1, type: 'king' } },
    { position: { x: 3, y: 4 }, piece: { color: 'white', id: 1, type: 'queen' } },
    { position: { x: 4, y: 4 }, piece: { color: 'black', id: 1, type: 'pawn' } },
    { position: { x: 5, y: 2 }, piece: { color: 'black', id: 1, type: 'knight' } },
  ])
  const queen = board[4][3].piece!
  const moves = movesForPiece({ piece: queen, board, propagateDetectCheck: true })
  const capture = moves.find(
    (m) => m.type === 'capture' && m.newPosition.x === 4 && m.newPosition.y === 4,
  )
  assert(!!capture, 'losing: Qxp move exists')
  if (capture) {
    const p = previewMove(board, capture)
    assert(p.captureTrade?.label === 'losing', `losing label=${p.captureTrade?.label}`)
    assert(p.destinationThreatened, 'losing: landing threatened')
    assert(washColorForPreview(p) === '#ff4040', 'losing wash red')
    const icons = iconsForPreview(p)
    assert(icons.includes('losing'), `losing icon in ${icons}`)
  }
}

// 4) Gives check — rook checks king
{
  const board = createTestBoard([
    { position: { x: 0, y: 7 }, piece: { color: 'white', id: 1, type: 'king' } },
    { position: { x: 4, y: 0 }, piece: { color: 'black', id: 1, type: 'king' } },
    { position: { x: 0, y: 4 }, piece: { color: 'white', id: 1, type: 'rook' } },
  ])
  const rook = board[4][0].piece!
  const moves = movesForPiece({ piece: rook, board, propagateDetectCheck: true })
  const toFile = moves.find(
    (m) => m.newPosition.x === 4 && m.newPosition.y === 4,
  )
  assert(!!toFile, 'check: rook to e4 exists')
  if (toFile) {
    const p = previewMove(board, toFile)
    assert(p.givesCheck, 'check: givesCheck true')
    assert(iconsForPreview(p).includes('check'), 'check icon')
  }
}

// 5) Threatened quiet square
{
  const board = createTestBoard([
    { position: { x: 0, y: 7 }, piece: { color: 'white', id: 1, type: 'king' } },
    { position: { x: 7, y: 0 }, piece: { color: 'black', id: 1, type: 'king' } },
    { position: { x: 0, y: 6 }, piece: { color: 'white', id: 1, type: 'knight' } },
    { position: { x: 3, y: 3 }, piece: { color: 'black', id: 1, type: 'rook' } },
  ])
  // white knight a2 can go to b4 (1,4) — attacked by black rook on d5? rook at d5 is x=3,y=3
  // knight a2 = (0,6). Moves: b4=(1,4), c3=(2,5), c1=(2,7)...
  // Put black rook on b-file attacking b4: rook at (1,0) attacks down file
  const board2 = createTestBoard([
    { position: { x: 0, y: 7 }, piece: { color: 'white', id: 1, type: 'king' } },
    { position: { x: 7, y: 0 }, piece: { color: 'black', id: 1, type: 'king' } },
    { position: { x: 0, y: 6 }, piece: { color: 'white', id: 1, type: 'knight' } },
    { position: { x: 1, y: 0 }, piece: { color: 'black', id: 1, type: 'rook' } },
  ])
  const knight = board2[6][0].piece!
  const moves = movesForPiece({ piece: knight, board: board2, propagateDetectCheck: true })
  const b4 = moves.find((m) => m.newPosition.x === 1 && m.newPosition.y === 4)
  assert(!!b4, 'threat: Nb4 exists')
  if (b4) {
    const p = previewMove(board2, b4)
    assert(p.destinationThreatened, 'threat: Nb4 threatened by rook')
    assert(washColorForPreview(p) === '#ff4040', 'threat wash red')
  }
}

// 6) Always-on: piece currently threatened
{
  const board = createTestBoard([
    { position: { x: 0, y: 7 }, piece: { color: 'white', id: 1, type: 'king' } },
    { position: { x: 7, y: 0 }, piece: { color: 'black', id: 1, type: 'king' } },
    { position: { x: 3, y: 4 }, piece: { color: 'white', id: 1, type: 'knight' } },
    { position: { x: 3, y: 0 }, piece: { color: 'black', id: 1, type: 'rook' } },
  ])
  const keys = threatenedPieceKeys(board, 'white')
  assert(keys.has('3,4'), 'white knight on d4 threatened by rook')
  assert(!keys.has('0,7'), 'white king not threatened')
}

// 7) Protected by knight (Nc3 guards Pe4) — must count same-color defense
{
  const board = createTestBoard([
    { position: { x: 4, y: 7 }, piece: { color: 'white', id: 1, type: 'king' } },
    { position: { x: 4, y: 0 }, piece: { color: 'black', id: 1, type: 'king' } },
    { position: { x: 2, y: 5 }, piece: { color: 'white', id: 1, type: 'knight' } }, // c3
    { position: { x: 4, y: 4 }, piece: { color: 'white', id: 1, type: 'pawn' } }, // e4
  ])
  const keys = protectedPieceKeys(board, 'white')
  assert(keys.has('4,4'), 'Pe4 protected by Nc3')
}

// 8) Contested = threatened + protected → violet bucket
{
  const board = createTestBoard([
    { position: { x: 4, y: 7 }, piece: { color: 'white', id: 1, type: 'king' } },
    { position: { x: 4, y: 0 }, piece: { color: 'black', id: 1, type: 'king' } },
    { position: { x: 2, y: 5 }, piece: { color: 'white', id: 1, type: 'knight' } }, // c3 guards e4
    { position: { x: 4, y: 4 }, piece: { color: 'white', id: 1, type: 'pawn' } }, // e4
    { position: { x: 4, y: 1 }, piece: { color: 'black', id: 1, type: 'rook' } }, // e7 attacks e4
  ])
  const safety = pieceSafetyMap(board, 'white')
  assert(safety.get('4,4') === 'contested', `Pe4 contested got ${safety.get('4,4')}`)
}

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nAll move-preview logic checks passed')
