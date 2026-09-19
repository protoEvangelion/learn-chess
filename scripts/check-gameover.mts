/**
 * Compare our detectGameOver vs chess.js.
 * Run: npx vite-node scripts/check-gameover.mts
 */
import { Chess } from 'chess.js'
import { fenToGame } from '../src/lib/fenBridge.ts'
import {
  detectGameOver,
  movesForPiece,
  isKingInCheck,
} from '../src/logic/pieces/index.ts'

type Expect = 'checkmate' | 'stalemate' | null

const cases: { name: string; fen: string }[] = [
  {
    name: 'user position (Kd7 escapes)',
    fen: '1R2k3/N3P3/5K2/8/8/4P3/1N6/8 b - - 0 1',
  },
  {
    name: 'fool mate',
    fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
  },
  {
    name: 'stalemate corner Q',
    fen: 'k7/2Q5/1K6/8/8/8/8/8 b - - 0 1',
  },
  {
    name: 'stalemate with rook-like Q',
    fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
  },
  {
    name: 'queen mate',
    fen: '6k1/6Q1/6K1/8/8/8/8/8 b - - 0 1',
  },
  {
    name: 'scholar mate',
    fen: 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4',
  },
  {
    name: 'back rank mate',
    fen: '3R2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1',
  },
  {
    name: 'smothered mate',
    fen: '6rk/5Npp/8/8/8/8/8/6K1 b - - 0 1',
  },
  {
    name: 'starting position',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  },
  {
    name: 'bare kings',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
  },
  // Castling while in check should NOT be a legal escape
  {
    name: 'in check cannot castle',
    fen: 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', // not in check actually
  },
  {
    name: 'check on e-file blocks castle',
    fen: 'r3k2r/8/8/4R3/8/8/8/4K3 b kq - 0 1',
  },
  // King must not castle through check
  {
    name: 'castle through check illegal',
    fen: 'r3k2r/8/8/8/8/5q2/8/R3K2R w KQkq - 0 1',
  },
]

function ours(fen: string): Expect {
  const g = fenToGame(fen)
  if (!g) throw new Error(`bad fen ${fen}`)
  return detectGameOver(g.board, g.turn)
}

function theirs(fen: string): Expect {
  const c = new Chess(fen)
  if (c.isCheckmate()) return 'checkmate'
  if (c.isStalemate()) return 'stalemate'
  return null
}

function legalSans(fen: string) {
  return new Chess(fen).moves().sort()
}

function ourLegalCount(fen: string) {
  const g = fenToGame(fen)!
  let n = 0
  const legal: string[] = []
  for (const tile of g.board.flat()) {
    if (tile.piece?.color !== g.turn) continue
    const moves = movesForPiece({
      piece: tile.piece,
      board: g.board,
      propagateDetectCheck: true,
    })
    for (const m of moves) {
      if (
        m.type === 'valid' ||
        m.type === 'capture' ||
        m.type === 'captureEnPassant' ||
        m.type === 'castling'
      ) {
        n++
        legal.push(
          `${tile.piece.type}@${tile.position.x},${tile.position.y}->${m.newPosition.x},${m.newPosition.y}(${m.type})`,
        )
      }
    }
  }
  return { n, legal, inCheck: isKingInCheck(g.board, g.turn) }
}

let fails = 0
for (const t of cases) {
  const a = ours(t.fen)
  const b = theirs(t.fen)
  if (a !== b) {
    fails++
    const oursMoves = ourLegalCount(t.fen)
    console.log('FAIL gameOver', t.name, {
      ours: a,
      chessjs: b,
      chessMoves: legalSans(t.fen),
      oursMoves,
    })
  } else {
    console.log('ok  gameOver', t.name, a)
  }
}

// Move-count fuzz: random-ish FENs from short games
const fuzzSeeds = [
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
  '8/8/8/8/8/8/6k1/4K2R w K - 0 1',
  '8/8/8/8/8/8/6k1/R3K3 w Q - 0 1',
]

for (const fen of fuzzSeeds) {
  try {
    const c = new Chess(fen)
    const chessN = c.moves().length
    const { n, legal, inCheck } = ourLegalCount(fen)
    const goA = ours(fen)
    const goB = theirs(fen)
    if (goA !== goB) {
      fails++
      console.log('FAIL fuzz gameOver', fen, { goA, goB, chessN, n, inCheck })
    } else if (n !== chessN) {
      // Castling / EP diffs are the usual suspects
      fails++
      console.log('FAIL fuzz moveCount', fen, {
        ours: n,
        chessjs: chessN,
        chessMoves: c.moves(),
        oursLegal: legal,
        inCheck,
      })
    } else {
      console.log('ok  fuzz', fen.split(' ')[0], { n, go: goA })
    }
  } catch (e) {
    fails++
    console.log('FAIL fuzz throw', fen, e)
  }
}

console.log(fails ? `\n${fails} failure(s)` : `\nall passed`)
process.exit(fails ? 1 : 0)
