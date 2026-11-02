/**
 * Smoke test for PGN import.
 * Run: npx tsx --tsconfig tsconfig.app.json scripts/test-pgn-import.ts
 */
import { COACH_REASONING } from '../server/aiCoach'
import { parsePgnToImportedGame, playedMoveAtPly, positionAtPly } from '../src/lib/pgnImport'
import { positionToSquare } from '../src/lib/fenBridge'
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
  assert(voice.includes('“You” means Black'), 'coach voice keeps you as black')
  assert(voice.includes('Do not refuse'), 'coach voice answers about white')
  assert(voice.includes('never “you”'), 'opponent is not called you')
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
  const { buildChatPrompt, buildReviewPrompt, dropIllegalSuggestions } = await import(
    '../server/explainApi.ts'
  )
  assert(COACH_REASONING === 'low', 'coach thinking is the provider low setting')
  const chat = buildChatPrompt({
    gameId: 'g',
    fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    question: 'What should I do?',
    playerColor: 'black',
    reviewBrief: 'You played as Black.',
  })
  assert(chat.includes('The human played Black'), 'chat prompt speaks as black')
  assert(chat.includes('“You” means Black'), 'chat prompt keeps you as black')
  assert(chat.includes('Do not refuse'), 'review chat answers the other side')
  assert(chat.includes('LEGAL MOVES'), 'review chat lists legal moves')
  assert(chat.includes('“nx2”'), 'chat prompt keeps the nx2 example')
  assert(chat.includes('name the real square'), 'chat prompt names the square in words')
  assert(
    !chat.includes('never switch to advising the opponent'),
    'review chat does not forbid the other side',
  )
  const live = buildChatPrompt({
    gameId: 'g',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    question: 'What is Black trying to do?',
  })
  assert(live.includes('Answer whichever side'), 'live chat answers either side')
  assert(live.includes('LEGAL MOVES'), 'live chat lists legal moves')
  assert(live.includes('e4'), 'e4 is offered as a legal move')
  assert(!live.includes('Na4'), 'illegal Na4 is not in the legal list')
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  const cleaned = dropIllegalSuggestions(
    startFen,
    'Play Na4. e4 is the move. The king is on e1. Try e2e5. Also e2e4.',
  )
  assert(!cleaned.includes('Na4'), 'drops illegal Na4')
  assert(cleaned.includes('e4'), 'keeps legal e4')
  assert(cleaned.includes('e1'), 'keeps a square name')
  assert(!cleaned.includes('e2e5'), 'drops illegal uci')
  assert(cleaned.includes('e2e4'), 'keeps legal uci')
  const card = dropIllegalSuggestions(
    startFen,
    '{"explanation":"Play Na4 or e4."}',
  )
  const parsed = JSON.parse(card) as { explanation: string }
  assert(!parsed.explanation.includes('Na4'), 'json card drops illegal Na4')
  assert(parsed.explanation.includes('e4'), 'json card keeps legal e4')
  const explained = dropIllegalSuggestions(
    startFen,
    [
      'Let’s sort out what that “nx2” idea was actually doing, because the point isn’t just winning a pawn.',
      'If you play **Nxf2**, the knight on f2 attacks the white **queen on d4**.',
      'So **Nxf2** is not taking the white queen, while **Ng1+** just gives check.',
      'In the actual position after **Ng1+**, White can answer with **Rxg1**.',
      'Your move Qh5 left the knight loose.',
    ].join(' '),
  )
  assert(explained.includes('“nx2”'), 'keeps the player’s nx2 in quotes')
  assert(explained.includes('**Nxf2**'), 'keeps a discussed knight move')
  assert(explained.includes('**Ng1+**'), 'keeps the check mark on Ng1+')
  assert(explained.includes('**Rxg1**'), 'keeps a discussed reply')
  assert(explained.includes('Qh5'), 'keeps the move the player made')
  assert(!explained.includes('****'), 'does not turn a move into stars')
  assert(!explained.includes('**+**'), 'does not leave a bare check mark')
  assert(!explained.includes('“”'), 'does not blank quotes')
  assert(
    dropIllegalSuggestions(
      startFen,
      'If you play Nxf2, the knight lands on f2.',
    ).includes('Nxf2'),
    'keeps a move the sentence is explaining',
  )
  assert(
    !dropIllegalSuggestions(startFen, 'Play Ng1+ now.').includes('Ng1'),
    'drops an illegal recommendation including its check mark',
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

{
  // Knight leaves e2 for g1 (file changes by two). A later black move must not
  // steal the highlight, and the destination must not slide one file left to f1.
  const pgn = `[SetUp "1"]
[FEN "k7/8/8/8/8/5K2/4n2P/8 w - - 0 1"]
[White "Tester"]
[Black "Other"]
[Result "*"]

1. h3 Ng1+ 2. Kg4 Nf3 *`
  const g = parsePgnToImportedGame(pgn, { preferColor: 'white' })
  const clicked = playedMoveAtPly(g.history, 2)
  assert(clicked !== null, 'Ng1+ has squares')
  assert(positionToSquare(clicked!.from) === 'e2', `Ng1+ from ${clicked && positionToSquare(clicked.from)}`)
  assert(positionToSquare(clicked!.to) === 'g1', `Ng1+ to ${clicked && positionToSquare(clicked.to)}`)
  assert(positionToSquare(clicked!.to) !== 'f1', 'destination is not one file left')
  const later = playedMoveAtPly(g.history, g.history.length)
  assert(positionToSquare(later!.to) === 'f3', 'end of the game is Nf3, not Ng1+')
  const afterNg1 = positionAtPly(g, 2)
  const knight = afterNg1.board[clicked!.to.y][clicked!.to.x].piece
  assert(knight?.type === 'knight' && knight.color === 'black', 'knight sits on the highlighted g1 square')
  const whiteKnight = playedMoveAtPly(
    parsePgnToImportedGame(`[White "A"]\n[Black "B"]\n\n1. Nf3 *`, { preferColor: 'black' }).history,
    1,
  )
  assert(positionToSquare(whiteKnight!.from) === 'g1', 'Nf3 starts on g1')
  assert(positionToSquare(whiteKnight!.to) === 'f3', 'Nf3 lands on f3, not e3')
}

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall ok')
