# Explorer database — build a month

Recipe for one Lichess month. Column meanings, why there are two tables, and why the indexes are ordered this way are in the root [README](../README.md#opening-explorer). Measured times and file sizes for the two September builds are in [explorer-build-comparison.md](explorer-build-comparison.md).

Do not upload these tables to Turso. Opening cards use Turso. That is a separate feature.

## Rules

- Source: `https://database.lichess.org/standard/lichess_db_standard_rated_YYYY-MM.pgn.zst`. Do not unzip.
- Drop bots, missing ratings, unfinished results, and anything that is not blitz, rapid, or classical. Clock estimate is `initial + 40 × increment`: blitz 180–479, rapid 480–1499, classical 1500–21599.
- Rating band is the average of the two ratings, floored into `0`, `1000`, `1200`, `1400`, `1600`, `1800`, `2000`, `2200`, `2500`.
- Count only the first 50 plies. The game’s result still counts.
- Threshold stays **100**. A board or move is kept only when white + draw + black, summed across every speed and band, is at least 100. A non-zero speed × band cell is still stored when the board’s total is at least 100.
- Pass 1 is a fixed 256 MB sketch per table (`WIDTH 1<<27`, depth 1). It stores no counts. Pass 2 skips a board whose sketch estimate is under 100, so some real 100+ boards can be missing.
- `month` is `YYYY-MM` from the dump filename, stamped on every row. September’s existing file has no `month` column. A new build must have it.
- After the new month is in the file, add that `YYYY-MM` to `EXPLORER_MONTHS` in `src/lib/lichessExplorer.ts`. The All chip sends no month. A month chip sends `months=YYYY-MM`.

## Do not

- Do not point `--pass 2` at a finished sqlite. That command deletes the file and starts over.
- Do not reuse another month’s `explorer-sketch-*.bin`. New `--file`, empty `--data`.
- Do not put SQLite `GROUP BY` back into pass 2. On the first September build that grew a **293 GB** file, used 23 GB RAM, and was killed. Pass 2 now renames the raw tables. `--pass group` sums them on disk and keeps totals ≥ 100. That filter still needs free disk for the raw file (about 161 GB on this September rebuild) until `VACUUM INTO` replaces it.
- Do not lower the threshold to 30 or 50. The current file cannot be refiltered. Rows under 100 were deleted, and pass 2 never counted boards the sketch put under 100.
- Set `SQLITE_TMPDIR` to `.data`. `/tmp` is a 12 GB RAM disk.
- WSL RAM is 24 GB. A chunk is 2,000,000 games. 5,000,000 was killed at about 3,000,000 games and 24 GB. Do not raise the chunk above 2,000,000 on this machine.

## Schema the file must have

```sql
CREATE TABLE explorer_position (
    speed TEXT NOT NULL,
    rating_band TEXT NOT NULL,
    position TEXT NOT NULL,
    white INTEGER NOT NULL,
    draws INTEGER NOT NULL,
    black INTEGER NOT NULL,
    month TEXT NOT NULL
);

CREATE TABLE explorer_move (
    speed TEXT NOT NULL,
    rating_band TEXT NOT NULL,
    position TEXT NOT NULL,
    uci TEXT NOT NULL,
    san TEXT NOT NULL,
    white INTEGER NOT NULL,
    draws INTEGER NOT NULL,
    black INTEGER NOT NULL,
    month TEXT NOT NULL
);

CREATE INDEX explorer_position_lookup ON explorer_position (position, rating_band, speed);
CREATE INDEX explorer_move_lookup ON explorer_move (position, rating_band, speed);
CREATE INDEX explorer_position_month ON explorer_position (position, month, rating_band, speed);
CREATE INDEX explorer_move_month ON explorer_move (position, month, rating_band, speed);
```

`position` is the FEN, first four fields. Pass 2 writes unindexed `pos_raw` and `move_raw` (same columns, no `month`) and appends each chunk there. Sum those into the two tables, then drop the raw tables. Create indexes after the filter, not during the load.

The builder writes `.data/explorer-month.txt` from the filename and stamps `month` at the end of `--pass group`. The live September file is the 2,000,000-game rebuild: `month` is `2026-09` and all four indexes exist.

## Build

Binary: `explorer-rs/target/fast/explorer-build`.

```bash
cd explorer-rs
cargo build --profile fast
```

**1. Download.** Do not unzip.

September is already at `~/Downloads/lichess_db_standard_rated_2026-09.pgn.zst` (27.2 GB, 89,616,462 games).

**2. Pass 1.**

```bash
explorer-rs/target/fast/explorer-build \
  --pass 1 \
  --file ~/Downloads/lichess_db_standard_rated_YYYY-MM.pgn.zst \
  --data .data \
  --threshold 100
```

Writes `explorer-sketch-position.bin` and `explorer-sketch-move.bin`.

**3. Pass 2.** Count in chunks of 2,000,000. Each chunk: compact map in RAM, dump, clear RAM. One worker appends into `pos_raw` / `move_raw`. The raw tables are renamed to `explorer_position` and `explorer_move`. They are summed by the disk filter, not by SQLite `GROUP BY`.

```bash
explorer-rs/target/fast/explorer-build \
  --pass 2 \
  --file ~/Downloads/lichess_db_standard_rated_YYYY-MM.pgn.zst \
  --data .data \
  --threshold 100
```

This command no longer runs SQLite `GROUP BY`. It renames the raw tables and stops. `--pass group` sums duplicate chunk rows and drops anything under 100.

**4. Disk filter.** External sort, 4,000,000-row batches, k-way merge. Sums rows that share a speed, band, and board, then drops a board or move under 100. Peak RAM on the September rebuild was 0.9 GB.

```bash
explorer-rs/target/fast/explorer-build --pass group --data .data --threshold 100
```

**5. Indexes.** Run the four `CREATE INDEX` statements in [Schema](#schema-the-file-must-have). On the 2,000,000-game September file the four indexes took 14 sec.

**6. Compact.** SQLite does not shrink a file when rows are deleted.

```bash
sqlite3 .data/explorer-YYYY-MM.sqlite "VACUUM INTO '.data/explorer-YYYY-MM-compact.sqlite';"
```

Check the row counts, replace the fat file with the compact one, and delete the fat file. The 2,000,000-game rebuild of September is **4.1 GB** after the month column and the two month indexes: `explorer_position` 8,424,647 rows, `explorer_move` 8,262,321 rows, every `month` value `2026-09`. Confirm `month` is `YYYY-MM` on the rows.

**7. Clean up.** A finished pass deletes its chunk files. If a run is killed, delete leftover `explorer-part-*.sqlite` and `group-runs-*`. Keep the compact sqlite, the two sketch files until pass 2 has finished, `opening-book.json`, and the empty `group-position.done` / `group-move.done` markers. Those markers make the next `--pass group` skip that table. Delete a marker only to run that filter again.

**8. Serve.**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

`server/explorerDb.ts` opens `.data/explorer-2026-09.sqlite`. `EXPLORER_DATABASE_PATH` overrides that. Copy the compact file to a machine with a normal disk. Vercel’s serverless disk will not keep it between clicks.

A throwaway PGN for a slice check stays out of git. Use `--threshold 1` and a data directory that is not `.data`.

## Another month

1. Download `lichess_db_standard_rated_YYYY-MM.pgn.zst`. Do not unzip.
2. New `--file`. Empty `--data`. Do not reuse another month’s sketches.
3. Pass 1, pass 2 (chunks of 2,000,000), `--pass group`, the four indexes, `VACUUM INTO`.
4. Leave the finished sqlite in `.data/run-YYYY-MM/` next to `explorer-month.txt`. The server opens that file on its own. Do not run pass 2 in a data directory that already holds a finished month. Restart `npm run dev` so it sees the new month.

Pass 2 writes the raw chunk rows (161 GB for September). `--pass group` sums them and keeps totals ≥ 100. `VACUUM INTO` leaves the compact file (4.1 GB for September, with `month`). Without the sketch, that path took 1 hr 43 min, which is 1 hr 35 min faster than the first build. Numbers are in [explorer-build-comparison.md](explorer-build-comparison.md).
