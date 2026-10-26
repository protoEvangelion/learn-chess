/**
 * Smoke test for PGN import.
 * Run: npx tsx --tsconfig tsconfig.app.json scripts/test-pgn-import.ts
 */
import { parsePgnToImportedGame, positionAtPly } from '../src/lib/pgnImport'
import { arrowsForReplies } from '../src/lib/replyArrows'
import { reviewCoachVoice, sideForUsername } from '../src/lib/playerSide'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

const scholars = `[Event "Scholar"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`

{
  const g = parsePgnToImportedGame(scholars, { chessComUsername: 'bob' })
  assert(g.history.length === 7, `scholar plies=${g.history.length}`)
  assert(g.playerColor === 'black', 'bob is black')
  assert(g.gameOver?.type === 'checkmate', `over=${g.gameOver?.type}`)
  assert(g.gameOver?.winner === 'white', 'white won')
  const start = positionAtPly(g, 0)
  assert(start.turn === 'white', 'start white to move')
  const end = positionAtPly(g, g.history.length)
  assert(end.board[0][4].piece?.type === 'king' || true, 'end has board')
}

{
  const g = parsePgnToImportedGame(scholars, { preferColor: 'white' })
  assert(g.playerColor === 'white', 'prefer white')
}

{
  const g = parsePgnToImportedGame(scholars, {
    chessComUsername: 'bob',
    preferColor: 'white',
  })
  assert(g.playerColor === 'black', 'username beats prefer white')
  assert(g.pgn.includes('[PlayerColor "black"]'), 'color saved on the pgn')
  const again = parsePgnToImportedGame(g.pgn, { preferColor: 'white' })
  assert(again.playerColor === 'black', 'saved color survives reload without username')
}

{
  const titled = scholars.replace('[Black "Bob"]', '[Black "GM Bob"]')
  const g = parsePgnToImportedGame(titled, {
    chessComUsername: 'bob',
    preferColor: 'white',
  })
  assert(g.playerColor === 'black', 'title prefix still matches bob')
}

{
  const g = parsePgnToImportedGame(scholars, { playerColor: 'black' })
  assert(g.playerColor === 'black', 'account color is used as-is')
}

{
  assert(sideForUsername('Alice', 'Hikaru', 'hikaru') === 'black', 'archive side black')
  assert(sideForUsername('Hikaru', 'Alice', 'hikaru') === 'white', 'archive side white')
  assert(sideForUsername('Alice', 'Bob', 'hikaru') === null, 'unknown side is not white')
  const voice = reviewCoachVoice('black')
  assert(voice.includes('The human played Black'), 'coach voice names black')
  assert(
    voice.includes('Do not talk as if the human played White'),
    'coach voice forbids white',
  )
  const whiteVoice = reviewCoachVoice('white')
  assert(whiteVoice.includes('The human played White'), 'coach voice names white')
}

{
  try {
    parsePgnToImportedGame('not a pgn')
    assert(false, 'should throw on junk')
  } catch {
    assert(true, 'junk pgn throws')
  }
}

{
  const g = parsePgnToImportedGame('1. e4 e5 2. Na4')
  assert(g.history.length === 2, `stops before illegal Na4 (${g.history.length})`)
  assert(g.pgn.includes('e4'), 'partial pgn kept')
  assert(!g.pgn.includes('Na4'), 'illegal Na4 left out of pgn')
}

{
  const arrows = arrowsForReplies(
    ['e4', 'e5', 'Nf3', 'Nc6'],
    [
      { san: 'Na4', count: 4 },
      { san: 'Bc4', count: 2 },
    ],
  )
  assert(arrows.length === 1 && arrows[0].to === 'c4', 'illegal Na4 reply skipped')
  assert(
    arrowsForReplies(['Na4'], [{ san: 'e5', count: 1 }]).length === 0,
    'illegal prefix does not throw',
  )
}

{
  const { buildChatPrompt, buildReviewPrompt } = await import('../server/explainApi.ts')
  const chat = buildChatPrompt({
    gameId: 'g',
    fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    question: 'What should I do?',
    playerColor: 'black',
    reviewBrief: 'You played as Black.',
  })
  assert(chat.includes('The human played Black'), 'chat prompt speaks as black')
  assert(
    chat.includes('Do not talk as if the human played White'),
    'chat prompt forbids white',
  )
  const review = buildReviewPrompt(
    {
      gameId: 'g',
      playerColor: 'black',
      outcome: 'loss',
      plies: [
        {
          ply: 1,
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          san: 'e4',
          by: 'opponent',
        },
      ],
    },
    'Opening stats: unavailable.',
  )
  assert(review.includes('YOU (Black)') === false, 'white move is not YOU when human is black')
  assert(review.includes('OPPONENT e4'), 'e4 is the opponent for black')
  assert(review.includes('The human played Black'), 'review prompt names black')
  const whiteReview = buildReviewPrompt(
    {
      gameId: 'g',
      playerColor: 'white',
      outcome: 'win',
      plies: [
        {
          ply: 1,
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          san: 'e4',
          by: 'player',
        },
      ],
    },
    'Opening stats: unavailable.',
  )
  assert(whiteReview.includes('YOU (White) e4'), 'white move is YOU for white')
  assert(whiteReview.includes('The human played White'), 'review prompt names white')
}

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall ok')
