import type { DrillLine, DrillMove } from '@/lib/drills/types'

/**
 * Win rates are Black wins / all games with that move (draws sit in the
 * denominator only — the same split as `blackWinRate` in the explorer).
 *
 * Source: this project's explorer, months 2025-10 through 2026-09,
 * speeds bullet + blitz + rapid, ratings 1000, 1200, 1400, 1600, 1800, 2000.
 * Read through the live `/api/opening-explorer` (the month files are not on
 * every machine). Lichess's own explorer host refused this machine.
 *
 * Engine best is Stockfish via Lichess cloud eval for the position before
 * the ply. Castling comes back as king-to-rook (e1h1) and is stored as O-O.
 */

function compactGames(games: number): string {
  if (games >= 1_000_000) return `${(games / 1_000_000).toFixed(1)}M`
  if (games >= 10_000) return `${Math.round(games / 1_000)}k`
  if (games >= 1_000) return `${(games / 1_000).toFixed(1)}k`
  return String(games)
}

function blackWinRate(white: number, draws: number, black: number): string {
  const games = white + draws + black
  const pct = (100 * black) / games
  return `Black wins ${pct.toFixed(1)}% · ${compactGames(games)} games`
}

function ply(
  san: string,
  hint: string,
  engineBest: string,
  white: number,
  draws: number,
  black: number,
): DrillMove {
  return {
    san,
    hint,
    engineBest,
    winRate: blackWinRate(white, draws, black),
  }
}

/** One Black repertoire against the Advance. Human plays the odd plies. */
export const CARO_KANN_LINES: DrillLine[] = [
  {
    id: 'caro-advance-pin',
    name: 'Advance — Botvinnik-Carls',
    summary:
      'White’s usual Advance. Chip d4 with …c5, pin the knight, and park a knight on f5.',
    eco: 'B12',
    family: 'caro-kann',
    side: 'black',
    opening: 'caro-kann',
    moves: [
      ply(
        'e4',
        'They claim the center.',
        'e4',
        262501910,
        19192333,
        248780729,
      ),
      ply(
        'c6',
        'Caro-Kann. Back up …d5 and keep your light bishop free.',
        'e5',
        22797713,
        1826072,
        22983349,
      ),
      ply(
        'd4',
        'They build a pawn duo.',
        'd4',
        9703655,
        781281,
        9230733,
      ),
      ply(
        'd5',
        'Hit back. The pawn on c6 is what makes this safe.',
        'd5',
        9553257,
        776063,
        9130692,
      ),
      ply(
        'e5',
        'The Advance — the try this pool plays most.',
        'Nc3',
        3653823,
        282610,
        3643901,
      ),
      ply(
        'c5',
        'Hit d4 now. Bringing the bishop out first scores worse here.',
        'c5',
        1078463,
        87841,
        1185552,
      ),
      ply(
        'c3',
        'They prop d4 up with a pawn.',
        'Nf3',
        550301,
        47568,
        621865,
      ),
      ply(
        'Nc6',
        'Add a second attacker against d4.',
        'Nc6',
        412697,
        36278,
        478784,
      ),
      ply(
        'Nf3',
        'The knight steps up to defend d4.',
        'Be2',
        203899,
        18912,
        257506,
      ),
      ply(
        'cxd4',
        'Open the file while that knight is the only defender.',
        'cxd4',
        60525,
        5845,
        78907,
      ),
      ply(
        'cxd4',
        'They recapture. The d-pawn is now a target.',
        'cxd4',
        57293,
        5562,
        75128,
      ),
      ply(
        'Bg4',
        'Pin the knight that holds d4. That’s the cheap shot.',
        'Bg4',
        81296,
        8004,
        107485,
      ),
      ply(
        'Be2',
        'They step the bishop out to break the pin.',
        'Be3',
        34239,
        3330,
        46836,
      ),
      ply(
        'e6',
        'Blunt that bishop and free your dark-squared bishop.',
        'e6',
        36663,
        3638,
        50990,
      ),
      ply(
        'O-O',
        'King to safety. The pin is still annoying.',
        'O-O',
        17900,
        1679,
        24144,
      ),
      ply(
        'Nge7',
        'Reroute this knight toward f5. Don’t block it.',
        'Nge7',
        17330,
        1681,
        24241,
      ),
      ply(
        'Nc3',
        'They develop and keep an eye on d4.',
        'Nbd2',
        5013,
        477,
        6959,
      ),
      ply(
        'Nf5',
        'Park the knight on f5. It eyes d4 and the dark squares.',
        'Nf5',
        6038,
        559,
        8435,
      ),
      ply(
        'Be3',
        'They challenge the knight. Don’t trade it off.',
        'Ne1',
        3450,
        350,
        4348,
      ),
      ply(
        'Be7',
        'Tuck the bishop out and get ready to castle. Line done.',
        'h5',
        3461,
        369,
        4707,
      ),
    ],
  },
]
