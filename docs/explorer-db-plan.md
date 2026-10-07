# Explorer database

Vercel queries two Turso aggregation tables, designed for win rate by board, speed, and rating band, and filled once from a month of Lichess games.

The game file is only needed while the counts are built. Download it, fill Turso, delete it. One month is about 30 GB. This Cursor cloud machine has about 245 GB free, so that job fits here. The machine is temporary, so it is not a place to keep the file. Keep the file on the Mac Mini only if you want it there for the next month.

## Why two tables

`explorer_move` answers: from this board, which replies were played, and how did those games end? `san` is the reply, such as `e5`. `white`, `draws`, and `black` are how those games ended.

`explorer_position` answers: how many games reached this board at all? The same three counts, for everyone who reached the board, including replies we hid.

Moves played under 100 times this month are left off `explorer_move`. Those games still reached the board, so the reply rows add up to less than the position row. After 1. e4, 1,000 games reached the board, 600 played e5, 300 played c5, and 100 played rare replies we do not list. The position row keeps the 1,000.

## What a row is

A row is one bucket: this month, this speed (blitz, rapid, or classical), this rating band, this board. It holds three numbers: white wins, draws, black wins.

`explorer_position` — games that reached the board. One row per bucket that reached it at least 100 times.

`explorer_move` — games that played one move from that board. Same bucket, plus the move (`e4`). One row per bucket that is not zero. The move is kept only if it was played at least 100 times this month, adding every speed and band together.

The next month is more rows with a new `month`. The click adds months together. No new columns.

## Columns and ids

There is no separate id number. The id is the columns that make a row unique.

`position` is the FEN with the two clock numbers removed, so two move orders that reach the same pieces share a row.

`explorer_position`

| Column | Example | Meaning |
| --- | --- | --- |
| `month` | `2026-09` | which file the row came from |
| `speed` | `blitz` | `blitz`, `rapid`, or `classical` |
| `rating_band` | `1600` | `0`, `1000`, `1200`, `1400`, `1600`, `1800`, `2000`, `2200`, `2500` |
| `position` | the board | FEN without the clock numbers |
| `white`, `draws`, `black` | `120, 40, 90` | games that reached this board and ended that way |

Id: `month`, `speed`, `rating_band`, `position`.

`explorer_move`

| Column | Example | Meaning |
| --- | --- | --- |
| `month`, `speed`, `rating_band`, `position` | same as above | the same bucket |
| `uci` | `e2e4` | the move, used in the id |
| `san` | `e4` | the same move, shown on the page |
| `white`, `draws`, `black` | `80, 20, 40` | games that played this move and ended that way |

Id: `month`, `speed`, `rating_band`, `position`, `uci`.

Lookup index on both tables: `position`, `rating_band`, `speed`, `month`. A click looks up one board.

## How a click queries

The page sends the board and the rating bands you picked. Vercel adds the matching rows and sorts by the side to move’s win rate (wins divided by games). Draws stay in the game count.

```sql
SELECT san,
       SUM(white) AS white,
       SUM(draws) AS draws,
       SUM(black) AS black
FROM explorer_move
WHERE position = ?
  AND rating_band IN ('1600')
  AND speed IN ('blitz', 'rapid', 'classical')
GROUP BY san
```

The board total is the same filter on `explorer_position`, summed. The lookup uses an index on the board, so it reads that board’s rows only.

## Cost

Clicks fit on the free plans. Loading the month might not.

Vercel Hobby is $0. It includes 1 million function calls a month. One click is one call.

Turso Free is $0: 5 GB storage, 500 million rows read a month, 10 million rows written a month. These are shared with the tables we already have. Past any one limit, Turso blocks the database. The free plan does not bill the extra.

A click reads tens or hundreds of rows. Half a billion reads is far more clicks than this app will see.

The load writes every row, and each index counts as another write. A likely load is a few million rows. The ceiling is low tens of millions. That can fit in 5 GB and 10 million writes, or it can pass the write cap. If it does, Developer is $5.99 a month ($4.99 billed yearly): 9 GB and 25 million writes.

Check the row count after the first load. Stay on free if it fits. Move to Developer only if the load hits the cap.
