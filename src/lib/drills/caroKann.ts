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
 *
 * The explorer stores a board, not a move order. Once two orders reach the
 * same squares, later plies count every game on that board. That is why the
 * Modern line’s numbers jump at …Nf6 (Classical games join) and why the
 * Exchange line’s numbers jump after 4.Nf3 (2.Nf3 games join).
 *
 * Picker order: cheap shots first, then White’s common tries. After
 * 1.e4 c6 2.d4 d5 in this pool the third moves are 3.e5 7.58M (38.3%),
 * 3.exd5 6.02M (30.4%), 3.Nc3 4.11M (20.8%), 3.f3 782k (4.0%),
 * 3.Nd2 777k (3.9%). 3.Bd3 is 218k (1.1%) and 3.f4 is 11k (0.1%), so
 * those two do not get a line.
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

/** Black Caro-Kann drills. Traps first, then White’s common tries. Human plays the odd plies. */
export const CARO_KANN_LINES: DrillLine[] = [
  {
    id: 'caro-loose-bishop',
    name: 'Trap — loose bishop',
    summary:
      'They drop the bishop on c4 while your pawn still hits d5. Take it, then pin the knight.',
    eco: 'B10',
    family: 'caro-kann',
    side: 'black',
    opening: 'caro-kann',
    moves: [
      ply('e4', 'They claim the center.', 'e4', 262501910, 19192333, 248780729),
      ply(
        'c6',
        'Caro-Kann. Back up …d5 and keep your light bishop free.',
        'e5',
        22797713,
        1826072,
        22983349,
      ),
      ply(
        'Nf3',
        'Knight out first. Very common at this level.',
        'd4',
        6535338,
        539453,
        6866424,
      ),
      ply('d5', 'Strike in the center before that bishop settles.', 'd5', 6110937, 512412, 6469645),
      ply(
        'Bc4',
        'The bishop steps onto a square your pawn already attacks.',
        'e5',
        19549,
        1666,
        34679,
      ),
      ply('dxc4', 'The bishop is loose. Take it.', 'dxc4', 19926, 1742, 37635),
      ply('d3', 'They try to open the line. You are a piece up.', 'Qe2', 4911, 504, 7717),
      ply(
        'Bg4',
        'Pin the knight. You already won the bishop — no need to grab the pawn.',
        'Bg4',
        867,
        87,
        1485,
      ),
    ],
  },
  {
    id: 'caro-bishop-grab',
    name: 'Trap — bishop takes d5',
    summary:
      'Hillbilly move order. If the bishop captures on d5, take the bishop with the queen.',
    eco: 'B10',
    family: 'caro-kann',
    side: 'black',
    opening: 'caro-kann',
    moves: [
      ply('e4', 'They claim the center.', 'e4', 262501910, 19192333, 248780729),
      ply(
        'c6',
        'Caro-Kann. Back up …d5 and keep your light bishop free.',
        'e5',
        22797713,
        1826072,
        22983349,
      ),
      ply(
        'Bc4',
        'The Hillbilly. The bishop is already in the way of …d5.',
        'd4',
        1433119,
        113556,
        1700800,
      ),
      ply('d5', 'Hit the bishop and the center pawn together.', 'd5', 1293896, 104230, 1565490),
      ply('exd5', 'They take on d5. The bishop is still on c4.', 'exd5', 1222119, 99038, 1468406),
      ply('cxd5', 'Recapture and attack the bishop.', 'cxd5', 1216753, 98770, 1464765),
      ply(
        'Bxd5',
        'They grab the pawn. The bishop is now loose.',
        'Bb3',
        2689,
        330,
        8672,
      ),
      ply('Qxd5', 'Take the bishop. You are a piece up. Line done.', 'Qxd5', 1837, 264, 7183),
    ],
  },
  {
    id: 'caro-queen-raid',
    name: 'Trap — early queen',
    summary: 'Qh5 is a raid this pool actually plays. Answer with …d5 and recapture.',
    eco: 'B10',
    family: 'caro-kann',
    side: 'black',
    opening: 'caro-kann',
    moves: [
      ply('e4', 'They claim the center.', 'e4', 262501910, 19192333, 248780729),
      ply(
        'c6',
        'Caro-Kann. Back up …d5 and keep your light bishop free.',
        'e5',
        22797713,
        1826072,
        22983349,
      ),
      ply('Qh5', 'Early queen. It looks scary and it is not.', 'd4', 46344, 3576, 63928),
      ply('d5', 'Ignore the queen. Hit the center.', 'Nf6', 28213, 2222, 40382),
      ply('exd5', 'They trade. Your pawn comes back.', 'Qh4', 19027, 1607, 27656),
      ply('cxd5', 'Recapture. Their queen is still out of play. Line done.', 'cxd5', 15266, 1216, 22192),
    ],
  },
  {
    id: 'caro-hillbilly',
    name: 'Hillbilly — bishop retreat',
    summary:
      'The usual Hillbilly, when they do not drop the bishop. Take on d5, develop, and pin.',
    eco: 'B10',
    family: 'caro-kann',
    side: 'black',
    opening: 'caro-kann',
    moves: [
      ply('e4', 'They claim the center.', 'e4', 262501910, 19192333, 248780729),
      ply(
        'c6',
        'Caro-Kann. Back up …d5 and keep your light bishop free.',
        'e5',
        22797713,
        1826072,
        22983349,
      ),
      ply(
        'Bc4',
        'The Hillbilly. A common trick at this level.',
        'd4',
        1433119,
        113556,
        1700800,
      ),
      ply('d5', 'Hit the bishop and the center pawn together.', 'd5', 1293896, 104230, 1565490),
      ply('exd5', 'They take. The bishop has to move.', 'exd5', 1222119, 99038, 1468406),
      ply('cxd5', 'Recapture and attack the bishop.', 'cxd5', 1216753, 98770, 1464765),
      ply('Bb3', 'The usual retreat. The bishop bites on d5.', 'Bb3', 816318, 61425, 946012),
      ply('Nf6', 'Develop the knight. It scores a bit better than the bishop here.', 'Bf5', 280705, 21805, 334028),
      ply('d4', 'They finally build a pawn center.', 'h3', 89312, 7368, 105502),
      ply('Bg4', 'Pin the knight that holds d4. Line done.', 'Bg4', 18758, 1537, 25477),
    ],
  },
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
  {
    id: 'caro-exchange',
    name: 'Exchange — pin the knight',
    summary:
      'Second-most common third move. Recapture with the c-pawn and pin the knight on f3.',
    eco: 'B13',
    family: 'caro-kann',
    side: 'black',
    opening: 'caro-kann',
    moves: [
      ply('e4', 'They claim the center.', 'e4', 262501910, 19192333, 248780729),
      ply(
        'c6',
        'Caro-Kann. Back up …d5 and keep your light bishop free.',
        'e5',
        22797713,
        1826072,
        22983349,
      ),
      ply('d4', 'They build a pawn duo.', 'd4', 9703655, 781281, 9230733),
      ply('d5', 'Hit back. The pawn on c6 is what makes this safe.', 'd5', 9553257, 776063, 9130692),
      ply(
        'exd5',
        'The Exchange. Second only to the Advance in this pool.',
        'Nc3',
        2899146,
        265926,
        2853321,
      ),
      ply('cxd5', 'Recapture with the c-pawn. That is the Caro point.', 'cxd5', 2867863, 263432, 2833114),
      ply('Nf3', 'Their most common development here.', 'Nf3', 869249, 81198, 897248),
      ply('Nc6', 'Develop and eye d4.', 'Nc6', 1464873, 131839, 1558894),
      ply(
        'Nc3',
        'Their most common next try. The c-pawn stays home.',
        'c3',
        310367,
        26583,
        371523,
      ),
      ply(
        'Bg4',
        'Pin the knight that holds d5. That’s the cheap shot in the Exchange.',
        'a6',
        322732,
        28321,
        404253,
      ),
    ],
  },
  {
    id: 'caro-classical',
    name: 'Classical — …Nf6',
    summary:
      'Third-most common try. Take on e4, chase the knight with …Nf6, and recapture with the e-pawn.',
    eco: 'B18',
    family: 'caro-kann',
    side: 'black',
    opening: 'caro-kann',
    moves: [
      ply('e4', 'They claim the center.', 'e4', 262501910, 19192333, 248780729),
      ply(
        'c6',
        'Caro-Kann. Back up …d5 and keep your light bishop free.',
        'e5',
        22797713,
        1826072,
        22983349,
      ),
      ply('d4', 'They build a pawn duo.', 'd4', 9703655, 781281, 9230733),
      ply('d5', 'Hit back. The pawn on c6 is what makes this safe.', 'd5', 9553257, 776063, 9130692),
      ply('Nc3', 'The Classical. Knight hits d5 and e4.', 'Nc3', 2104731, 162731, 1840406),
      ply('dxe4', 'Take. Make the knight recapture.', 'dxe4', 1883078, 151808, 1673281),
      ply('Nxe4', 'They recapture. The knight is a target.', 'Nxe4', 1613727, 136550, 1465077),
      ply('Nf6', 'Attack that knight. The usual and the best score here.', 'Nf6', 966628, 82762, 880726),
      ply('Nxf6+', 'They trade. That’s what this pool plays most.', 'Nxf6+', 483839, 49409, 460199),
      ply('exf6', 'Recapture toward the center and open the e-file. Line done.', 'exf6', 445714, 45816, 425158),
    ],
  },
  {
    id: 'caro-fantasy',
    name: 'Fantasy — …e5',
    summary:
      '3.f3 is the next real try. Grabbing on e4 scores poorly. Strike with …e5 and …Qb6.',
    eco: 'B12',
    family: 'caro-kann',
    side: 'black',
    opening: 'caro-kann',
    moves: [
      ply('e4', 'They claim the center.', 'e4', 262501910, 19192333, 248780729),
      ply(
        'c6',
        'Caro-Kann. Back up …d5 and keep your light bishop free.',
        'e5',
        22797713,
        1826072,
        22983349,
      ),
      ply('d4', 'They build a pawn duo.', 'd4', 9703655, 781281, 9230733),
      ply('d5', 'Hit back. The pawn on c6 is what makes this safe.', 'd5', 9553257, 776063, 9130692),
      ply(
        'f3',
        'The Fantasy. It looks like a gambit. Taking on e4 is the mistake.',
        'Nc3',
        414740,
        25242,
        341797,
      ),
      ply(
        'e5',
        'Don’t take the pawn. …e5 uses the hole f3 just made.',
        'e6',
        21563,
        1500,
        23893,
      ),
      ply('dxe5', 'They take. The diagonal to their king is open.', 'dxe5', 14141, 964, 15827),
      ply('Qb6', 'Queen to b6. It eyes b2 and that open diagonal. Line done.', 'Qb6', 2479, 173, 3324),
    ],
  },
  {
    id: 'caro-modern',
    name: 'Modern — Nd2',
    summary:
      'The other knight square. Take on e4. Once the knight lands on e4, play the Classical …Nf6.',
    eco: 'B15',
    family: 'caro-kann',
    side: 'black',
    opening: 'caro-kann',
    moves: [
      ply('e4', 'They claim the center.', 'e4', 262501910, 19192333, 248780729),
      ply(
        'c6',
        'Caro-Kann. Back up …d5 and keep your light bishop free.',
        'e5',
        22797713,
        1826072,
        22983349,
      ),
      ply('d4', 'They build a pawn duo.', 'd4', 9703655, 781281, 9230733),
      ply('d5', 'Hit back. The pawn on c6 is what makes this safe.', 'd5', 9553257, 776063, 9130692),
      ply('Nd2', 'Same idea as Nc3, one square over.', 'Nc3', 405743, 31640, 340098),
      ply('dxe4', 'Take. The knight recaptures.', 'dxe4', 323053, 26554, 274571),
      ply('Nxe4', 'Recaptured. This is the Classical board.', 'Nxe4', 322227, 26494, 273723),
      ply('Nf6', 'Same reply as Classical. Attack the knight.', 'Nf6', 966628, 82762, 880726),
      ply('Nxf6+', 'They trade. That’s the usual choice.', 'Nxf6+', 483839, 49409, 460199),
      ply('exf6', 'Recapture toward the center and open the e-file. Line done.', 'exf6', 445714, 45816, 425158),
    ],
  },
]
