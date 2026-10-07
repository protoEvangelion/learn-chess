# Explorer database

One month of counts in Turso. The site on Vercel reads them. The game file stays on the Mac Mini and is only used to fill the tables.

## Why two tables

The page shows two numbers: how many games reached this board, and how each next move turned out.

Moves played under 100 times this month are left off the list. Those games still reached the board, so the board total is not the sum of the moves we show. That total needs its own table.

## What a row is

A row is one bucket: this month, this speed (blitz, rapid, or classical), this rating band, this board. It holds three numbers: white wins, draws, black wins.

`explorer_position` — games that reached the board. One row per bucket that reached it at least 100 times.

`explorer_move` — games that played one move from that board. Same bucket, plus the move (`e4`). One row per bucket that is not zero. The move is kept only if it was played at least 100 times this month, adding every speed and band together.

The next month is more rows with a new `month`. The click adds months together. No new columns.

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
