# September build comparison

Same dump both times: `lichess_db_standard_rated_2026-09.pgn.zst`, 27.2 GB, 89,616,462 games. Same keep rule: a board or move stays when its games add up to at least 100. Machine: WSL, 24 GB RAM.

The first build counted 1,000,000 games at a time, then asked SQLite to add the chunks together. That step was killed. The second build counted 2,000,000 games at a time and added the chunks on disk. Pass 1 was not repeated. The second build reused the two 256 MB sketch files.

## What came out

| | First build | Second build |
| --- | --- | --- |
| Chunk size | 1,000,000 games | 2,000,000 games |
| How chunks were added | SQLite `GROUP BY`, then a disk filter | Disk filter sums the chunk rows and drops totals under 100 |
| `month` column | No | `2026-09` on every row |
| Board rows kept | 8,424,647 | 8,424,647 |
| Move rows kept | 8,262,321 | 8,262,321 |
| File you query | 2.7 GB | 4.1 GB |
| Biggest file along the way | 293 GB | 161 GB |

The 4.1 GB file is larger because it stores `month` and two extra indexes. The row counts match.

## Time and memory

| Step | First build | Second build |
| --- | --- | --- |
| Pass 1 sketch | 27 min, 512 MB | Skipped. Sketches already existed. |
| Count the games | 34 min 30 sec (2,070 sec). About 1.5 GB while a chunk was in memory. | 49 min 34 sec (2,974 sec). Peak 19.7 GB. |
| Add the chunks together | 2 hr 24 min. Hit 23 GB and was killed. Left a 293 GB file with 1,201,083,305 board cells and 398,924,175 move cells. | Included in the disk filter below. |
| Keep totals ≥ 100 | 19 min, 0.7 GB. This ran on the already-added cells. | 52 min 36 sec (3,156 sec). Peak 0.9 GB. This both added the chunk rows and dropped totals under 100. |
| Indexes | about 7 sec each, two indexes | 14 sec, four indexes |
| Compact (`VACUUM INTO`) | 17 sec, down to 2.7 GB | 15 sec, down to 4.1 GB |

## Overall, sketch left out

Pass 1 is 27 min and was not repeated. These totals start at the count.

| | First build | Second build |
| --- | --- | --- |
| Count | 2,070 sec | 2,974 sec |
| Add chunks and keep totals ≥ 100 | 8,640 sec until the kill, then 1,140 sec on disk | 3,156 sec on disk |
| Indexes | about 14 sec | 14 sec |
| Compact | 17 sec | 15 sec |
| **Total** | **11,881 sec (3 hr 18 min)** | **6,159 sec (1 hr 43 min)** |

The second build was **5,722 sec faster (1 hr 35 min)**. The first total includes the SQLite step that was killed after 2 hr 24 min. The disk filter still ran after that, on the 293 GB file.

## Third build: 1,000,000 games, sparse rows, sorted chunk files

Same September dump. Pass 1 was skipped again. Chunks went back to 1,000,000 games. Each board in RAM stores only the speed and rating cells that occurred. Each chunk is written already sorted, and the filter merges those files. There is no 161 GB SQLite copy during the count. Indexes and `VACUUM INTO` were not run. The live file was left as the second build.

| Step | Third build | Second build |
| --- | --- | --- |
| Count | 57 min 1 sec (3,421 sec). Peak 5.8 GB. | 49 min 34 sec (2,974 sec). Peak 19.7 GB. |
| Keep totals ≥ 100 | 17 min 30 sec (1,050 sec). Peak 0.4 GB. Merge of 364 board files and 159 move files. | 52 min 36 sec (3,156 sec). Peak 0.9 GB. |
| **Count + filter** | **4,472 sec (1 hr 15 min)** | **6,130 sec (1 hr 42 min)** |

Count + filter was **1,658 sec faster (27 min 38 sec)**. The count step itself was 7 min slower, because sorting each chunk now happens during the count (about 20 sec per chunk). The filter dropped from 53 min to 17 min 30 sec. Kept rows match the earlier builds: 8,424,647 boards and 8,262,321 moves, `month` `2026-09`.

## 5,000,000 did not fit

A chunk of 5,000,000 games was killed after 2 min 2 sec (122 sec). It had read 3,000,000 games and was using 23.0 GB. WSL’s limit is 24 GB. The finished run used 2,000,000.

## Rows before the keep rule

These are not the same kind of row. The first number is after SQLite had already added matching chunk rows together. The second number is before that add, so the same board can appear once per chunk.

| | First build, after SQLite add | Second build, raw chunk rows |
| --- | --- | --- |
| Board rows | 1,201,083,305 | 1,414,732,508 |
| Move rows | 398,924,175 | 598,481,632 |
| File | 293 GB | 161 GB |

After the keep rule, both runs stored the same 8,424,647 board rows and 8,262,321 move rows.
