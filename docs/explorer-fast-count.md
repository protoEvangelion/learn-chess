# Faster walk 2

Walk 1 can stay. It already finishes a full month in about 11 minutes. Walk 2 is the slow part, and this file is the replacement for its in-memory row.

The current row key is the text `speed|band|fen` (and `speed|band|fen|uci` for a move). Each worker keeps its own map, and games are handed out at random, so one popular board is stored again on every worker and again for every speed and rating band. The map starts near 167,000 games a second and was near 2,300 games a second by 66 million games.

## The row

One row per board. The lookup key is an 8-byte hash of the board text. The board text is stored once, on the row, and checked when the hash matches, so two boards that share a hash do not get added together.

```text
hash of the board
  fen text, once
  grid[3 speeds][9 bands][3 outcomes]
```

Speeds, in order: `blitz`, `rapid`, `classical`.

Bands, in order: `0`, `1000`, `1200`, `1400`, `1600`, `1800`, `2000`, `2200`, `2500`.

Outcomes, in order: white win, draw, black win.

A move row is the same grid. Its hash is the board text plus the UCI move. Store `san` once on that row.

The same board always goes to the same worker. Pick the worker from the high bits of the hash. A game contains many boards, so a parse thread sends a small update (hash, speed slot, band slot, outcome) to the worker that owns that board. Send those updates in batches of a few thousand. On the first time a hash is seen, send the board text too.

After the last game, each board already lives on one worker. Flatten the grid into the same SQLite rows the current `write_sqlite` writes. Drop a board or move whose cells add up to less than the threshold. Write every leftover cell that is not zero.

## What not to change

Filtering, the 50-ply cap, the FEN (first four fields), and the 100-game rule stay as in `docs/explorer-db-plan.md`. Pass 1 stays the fixed sketch. Opening names still come from `server/openingBook.ts`.

## Read the fixture as plain PGN

`fixtures/lichess-2026-09-slice.pgn` is plain text, 98,997,894 bytes, 42,050 games, cut on a game boundary. A path that ends in `.pgn` is read directly. A path that ends in `.pgn.zst` is still streamed through `zstd -dc`. Kill that `zstd` when a `--limit` is hit. Do not unzip the 27 GB month file.

The slice run must take `--data` and must not use `.data`. The full-month sketches on the Mac live in `.data`.
