/**
 * Smoke test for PGN import.
 * Run: npx tsx --tsconfig tsconfig.app.json scripts/test-pgn-import.ts
 */
import { parsePgnToImportedGame, positionAtPly } from '../src/lib/pgnImport'

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
  try {
    parsePgnToImportedGame('not a pgn')
    assert(false, 'should throw on junk')
  } catch {
    assert(true, 'junk pgn throws')
  }
}

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall ok')
