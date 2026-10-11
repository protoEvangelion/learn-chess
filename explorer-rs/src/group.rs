//! Drop boards and moves under the game threshold without sorting in RAM.
//!
//! The grouped tables are already in the scratch file. SQLite's delete loaded
//! the reject list into memory and was killed. This pass spills sorted runs to
//! disk, merges them with a fixed memory budget, and writes the keepers back.

use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering as AtomicOrdering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use rusqlite::{params, Connection};

const MAX_ROWS: usize = 4_000_000;
const MAX_BYTES: usize = 1_200_000_000;

struct Progress {
    rows: AtomicU64,
    kept: AtomicU64,
    runs: AtomicU64,
}

struct Pulse {
    stop: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl Drop for Pulse {
    fn drop(&mut self) {
        self.stop.store(true, AtomicOrdering::Relaxed);
        if let Some(handle) = self.handle.take() {
            handle.join().ok();
        }
    }
}

struct Rec {
    speed_off: u32,
    speed_len: u16,
    band_off: u32,
    band_len: u16,
    fen_off: u32,
    fen_len: u16,
    uci_off: u32,
    uci_len: u16,
    san_off: u32,
    san_len: u16,
    white: i64,
    draws: i64,
    black: i64,
}

struct Batch {
    buf: Vec<u8>,
    rows: Vec<Rec>,
}

#[derive(Clone)]
struct Owned {
    speed: String,
    band: String,
    fen: String,
    uci: String,
    san: String,
    white: i64,
    draws: i64,
    black: i64,
}

impl Owned {
    fn games(&self) -> i64 {
        self.white + self.draws + self.black
    }
}

struct Item {
    run: u32,
    row: Owned,
}

impl PartialEq for Item {
    fn eq(&self, other: &Self) -> bool {
        self.row.fen == other.row.fen && self.row.uci == other.row.uci
    }
}

impl Eq for Item {}

impl PartialOrd for Item {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Item {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .row
            .fen
            .cmp(&self.row.fen)
            .then_with(|| other.row.uci.cmp(&self.row.uci))
    }
}

struct RunReader {
    file: BufReader<File>,
}

struct Source {
    readers: Vec<RunReader>,
    heap: BinaryHeap<Item>,
    pending: Option<Owned>,
}

#[derive(Clone, Copy)]
enum Kind {
    Position,
    Move,
}

impl Kind {
    fn live(self) -> &'static str {
        match self {
            Kind::Position => "explorer_position",
            Kind::Move => "explorer_move",
        }
    }

    fn kept(self) -> &'static str {
        match self {
            Kind::Position => "explorer_position_kept",
            Kind::Move => "explorer_move_kept",
        }
    }

    fn marker(self) -> &'static str {
        match self {
            Kind::Position => "group-position.done",
            Kind::Move => "group-move.done",
        }
    }

    fn is_move(self) -> bool {
        matches!(self, Kind::Move)
    }
}

pub struct ChunkRuns {
    dir: PathBuf,
    batch: Batch,
    runs: usize,
}

impl ChunkRuns {
    pub fn create(dir: &Path) -> Self {
        if dir.exists() {
            fs::remove_dir_all(dir).ok();
        }
        fs::create_dir_all(dir).expect("chunk run dir");
        Self {
            dir: dir.to_path_buf(),
            batch: Batch {
                buf: Vec::new(),
                rows: Vec::new(),
            },
            runs: 0,
        }
    }

    pub fn runs(&self) -> usize {
        self.runs
    }

    pub fn push(
        &mut self,
        speed: &str,
        band: &str,
        fen: &str,
        uci: &str,
        san: &str,
        white: i64,
        draws: i64,
        black: i64,
    ) {
        if !self
            .batch
            .try_push(speed, band, fen, uci, san, white, draws, black)
        {
            let speed = speed.to_owned();
            let band = band.to_owned();
            let fen = fen.to_owned();
            let uci = uci.to_owned();
            let san = san.to_owned();
            self.spill();
            assert!(self
                .batch
                .try_push(&speed, &band, &fen, &uci, &san, white, draws, black));
        }
    }

    pub fn finish(&mut self) {
        if !self.batch.rows.is_empty() {
            self.spill();
        }
    }

    fn spill(&mut self) {
        write_run(&self.dir, self.runs, &mut self.batch);
        self.runs += 1;
    }
}

pub fn run(data: &Path, threshold: u64) {
    std::env::set_var("SQLITE_TMPDIR", data);
    if data.join("chunk-runs-position").is_dir() || data.join("chunk-runs-move").is_dir() {
        merge_dumped_runs(data, threshold);
        return;
    }
    let path = data.join("explorer-2026-09.sqlite");
    let db = Connection::open(&path).expect("open scratch");
    tune(&db);
    let progress = Arc::new(Progress {
        rows: AtomicU64::new(0),
        kept: AtomicU64::new(0),
        runs: AtomicU64::new(0),
    });
    let _pulse = spawn_pulse(Arc::clone(&progress), path.clone());
    filter(&db, data, Kind::Position, threshold, &progress);
    progress.rows.store(0, AtomicOrdering::Relaxed);
    progress.kept.store(0, AtomicOrdering::Relaxed);
    progress.runs.store(0, AtomicOrdering::Relaxed);
    filter(&db, data, Kind::Move, threshold, &progress);
    crate::stamp_saved_month(&db, data);
    let positions = max_rowid(&db, "explorer_position");
    let moves = max_rowid(&db, "explorer_move");
    log(format!(
        "{{\"pass\":\"group\",\"done\":true,\"positions\":{positions},\"moves\":{moves}}}"
    ));
}

fn merge_dumped_runs(data: &Path, threshold: u64) {
    let path = data.join("explorer-2026-09.sqlite");
    if !path.exists() {
        let db = Connection::open(&path).expect("create grouped db");
        db.pragma_update(None, "page_size", 65536).ok();
    }
    let db = Connection::open(&path).expect("open grouped db");
    tune(&db);
    let progress = Arc::new(Progress {
        rows: AtomicU64::new(0),
        kept: AtomicU64::new(0),
        runs: AtomicU64::new(0),
    });
    let _pulse = spawn_pulse(Arc::clone(&progress), path.clone());
    merge_kind(&db, data, Kind::Position, threshold, &progress);
    progress.rows.store(0, AtomicOrdering::Relaxed);
    progress.kept.store(0, AtomicOrdering::Relaxed);
    progress.runs.store(0, AtomicOrdering::Relaxed);
    merge_kind(&db, data, Kind::Move, threshold, &progress);
    crate::stamp_saved_month(&db, data);
    let positions = max_rowid(&db, "explorer_position");
    let moves = max_rowid(&db, "explorer_move");
    log(format!(
        "{{\"pass\":\"group\",\"done\":true,\"positions\":{positions},\"moves\":{moves}}}"
    ));
}

fn merge_kind(db: &Connection, data: &Path, kind: Kind, threshold: u64, progress: &Progress) {
    let live = kind.live();
    let kept = kind.kept();
    let marker = data.join(kind.marker());
    if marker.exists() {
        log(format!("{{\"pass\":\"group\",\"table\":\"{live}\",\"skipped\":true}}"));
        return;
    }
    let run_dir = data.join(match kind {
        Kind::Position => "chunk-runs-position",
        Kind::Move => "chunk-runs-move",
    });
    let mut runs = fs::read_dir(&run_dir)
        .unwrap_or_else(|_| panic!("missing {}", run_dir.display()))
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("bin"))
        .collect::<Vec<_>>();
    runs.sort();
    if runs.is_empty() {
        panic!("no sorted runs in {}", run_dir.display());
    }
    if table_exists(db, kept) {
        db.execute_batch(&format!("DROP TABLE {kept}"))
            .expect("drop partial kept");
    }
    log(format!(
        "{{\"pass\":\"group\",\"table\":\"{live}\",\"runs\":{},\"threshold\":{threshold},\"sorted\":true}}",
        runs.len()
    ));
    db.execute_batch(&format!(
        "CREATE TABLE {kept} (
            speed TEXT NOT NULL,
            rating_band TEXT NOT NULL,
            position TEXT NOT NULL,
            {}
            white INTEGER NOT NULL,
            draws INTEGER NOT NULL,
            black INTEGER NOT NULL
        )",
        if kind.is_move() {
            "uci TEXT NOT NULL, san TEXT NOT NULL,"
        } else {
            ""
        }
    ))
    .expect("create kept");
    let started = Instant::now();
    progress.runs.store(runs.len() as u64, AtomicOrdering::Relaxed);
    merge(db, kind, &runs, threshold, progress, started);
    if table_exists(db, live) {
        db.execute_batch(&format!("DROP TABLE {live}"))
            .expect("drop previous live");
    }
    rename_kept(db, kept, live);
    File::create(&marker).expect("marker");
    fs::remove_dir_all(&run_dir).ok();
    log(format!(
        "{{\"pass\":\"group\",\"table\":\"{live}\",\"kept\":{},\"runs\":{}}}",
        progress.kept.load(AtomicOrdering::Relaxed),
        runs.len()
    ));
}

fn filter(db: &Connection, data: &Path, kind: Kind, threshold: u64, progress: &Progress) {
    let live = kind.live();
    let kept = kind.kept();
    let marker = data.join(kind.marker());
    if !table_exists(db, live) && table_exists(db, kept) {
        rename_kept(db, kept, live);
        File::create(&marker).ok();
    }
    if marker.exists() {
        log(format!("{{\"pass\":\"group\",\"table\":\"{live}\",\"skipped\":true}}"));
        return;
    }
    if !table_exists(db, live) {
        panic!("missing {live}");
    }
    if table_exists(db, kept) {
        db.execute_batch(&format!("DROP TABLE {kept}"))
            .expect("drop partial kept");
    }
    let estimate = max_rowid(db, live);
    log(format!(
        "{{\"pass\":\"group\",\"table\":\"{live}\",\"estimate\":{estimate},\"threshold\":{threshold}}}"
    ));
    let run_dir = data.join(format!("group-runs-{live}"));
    if run_dir.exists() {
        fs::remove_dir_all(&run_dir).ok();
    }
    fs::create_dir_all(&run_dir).expect("run dir");
    let started = Instant::now();
    let runs = spill(db, kind, &run_dir, progress, estimate, started);
    db.execute_batch(&format!(
        "CREATE TABLE {kept} (
            speed TEXT NOT NULL,
            rating_band TEXT NOT NULL,
            position TEXT NOT NULL,
            {}
            white INTEGER NOT NULL,
            draws INTEGER NOT NULL,
            black INTEGER NOT NULL
        )",
        if kind.is_move() {
            "uci TEXT NOT NULL, san TEXT NOT NULL,"
        } else {
            ""
        }
    ))
    .expect("create kept");
    merge(db, kind, &runs, threshold, progress, started);
    log(format!("{{\"pass\":\"group\",\"table\":\"{live}\",\"dropping\":true}}"));
    db.execute_batch(&format!("DROP TABLE {live}"))
        .expect("drop unsorted");
    rename_kept(db, kept, live);
    File::create(&marker).expect("marker");
    fs::remove_dir_all(&run_dir).ok();
    log(format!(
        "{{\"pass\":\"group\",\"table\":\"{live}\",\"kept\":{},\"runs\":{}}}",
        progress.kept.load(AtomicOrdering::Relaxed),
        runs.len()
    ));
}

fn spill(
    db: &Connection,
    kind: Kind,
    run_dir: &Path,
    progress: &Progress,
    estimate: i64,
    started: Instant,
) -> Vec<PathBuf> {
    let sql = if kind.is_move() {
        "SELECT speed, rating_band, position, uci, san, white, draws, black FROM explorer_move"
    } else {
        "SELECT speed, rating_band, position, white, draws, black FROM explorer_position"
    };
    let mut stmt = db.prepare(sql).expect("read grouped");
    let mut rows = stmt.query([]).expect("query grouped");
    let mut batch = Batch {
        buf: Vec::new(),
        rows: Vec::new(),
    };
    let mut runs = Vec::new();
    let mut seen = 0u64;
    loop {
        let Some(row) = rows.next().expect("row") else {
            break;
        };
        let speed = row.get_ref(0).expect("speed").as_str().expect("speed text");
        let band = row.get_ref(1).expect("band").as_str().expect("band text");
        let fen = row.get_ref(2).expect("fen").as_str().expect("fen text");
        let (uci, san, white, draws, black) = if kind.is_move() {
            (
                row.get_ref(3).expect("uci").as_str().expect("uci text"),
                row.get_ref(4).expect("san").as_str().expect("san text"),
                row.get::<_, i64>(5).expect("white"),
                row.get::<_, i64>(6).expect("draws"),
                row.get::<_, i64>(7).expect("black"),
            )
        } else {
            (
                "",
                "",
                row.get::<_, i64>(3).expect("white"),
                row.get::<_, i64>(4).expect("draws"),
                row.get::<_, i64>(5).expect("black"),
            )
        };
        if !batch.try_push(speed, band, fen, uci, san, white, draws, black) {
            let speed = speed.to_owned();
            let band = band.to_owned();
            let fen = fen.to_owned();
            let uci = uci.to_owned();
            let san = san.to_owned();
            runs.push(write_run(run_dir, runs.len(), &mut batch));
            progress.runs.store(runs.len() as u64, AtomicOrdering::Relaxed);
            report(kind.live(), seen, estimate, &runs, started);
            assert!(batch.try_push(&speed, &band, &fen, &uci, &san, white, draws, black));
        }
        seen += 1;
        if seen % 1_000_000 == 0 {
            progress.rows.store(seen, AtomicOrdering::Relaxed);
        }
    }
    if !batch.rows.is_empty() {
        runs.push(write_run(run_dir, runs.len(), &mut batch));
    }
    progress.rows.store(seen, AtomicOrdering::Relaxed);
    progress.runs.store(runs.len() as u64, AtomicOrdering::Relaxed);
    report(kind.live(), seen, estimate, &runs, started);
    drop(rows);
    drop(stmt);
    runs
}

fn merge(
    db: &Connection,
    kind: Kind,
    runs: &[PathBuf],
    threshold: u64,
    progress: &Progress,
    started: Instant,
) {
    let insert_sql = if kind.is_move() {
        "INSERT INTO explorer_move_kept (speed, rating_band, position, uci, san, white, draws, black)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    } else {
        "INSERT INTO explorer_position_kept (speed, rating_band, position, white, draws, black)
         VALUES (?, ?, ?, ?, ?, ?)"
    };
    let mut source = Source::open(runs);
    db.execute_batch("BEGIN").expect("begin");
    loop {
        let mut stmt = db.prepare(insert_sql).expect("insert");
        let mut batch = 0usize;
        let mut finished = false;
        while batch < 500_000 {
            let Some(group) = source.next_group() else {
                finished = true;
                break;
            };
            let group = collapse_cells(&group);
            let sum: i64 = group.iter().map(Owned::games).sum();
            if threshold > 0 && sum < threshold as i64 {
                continue;
            }
            for row in &group {
                if kind.is_move() {
                    stmt.execute(params![
                        row.speed, row.band, row.fen, row.uci, row.san, row.white, row.draws,
                        row.black
                    ])
                    .expect("insert move");
                } else {
                    stmt.execute(params![
                        row.speed, row.band, row.fen, row.white, row.draws, row.black
                    ])
                    .expect("insert position");
                }
                batch += 1;
            }
            let kept = progress.kept.fetch_add(group.len() as u64, AtomicOrdering::Relaxed)
                + group.len() as u64;
            if kept % 1_000_000 < group.len() as u64 {
                let secs = started.elapsed().as_secs_f64().max(0.001);
                log(format!(
                    "{{\"pass\":\"group\",\"table\":\"{}\",\"merging\":true,\"kept\":{kept},\"perSec\":{:.0},\"rssMb\":{}}}",
                    kind.live(),
                    kept as f64 / secs,
                    rss_mb()
                ));
            }
        }
        drop(stmt);
        db.execute_batch("COMMIT").expect("commit");
        if finished {
            break;
        }
        db.execute_batch("BEGIN").expect("begin");
    }
}

/// Chunk dumps repeat the same speed, band, and board. Add those counts
/// before the keep rule so the stored row is one cell, not one cell per chunk.
fn collapse_cells(group: &[Owned]) -> Vec<Owned> {
    let mut out: Vec<Owned> = Vec::new();
    for row in group {
        if let Some(prev) = out
            .iter_mut()
            .find(|prev| prev.speed == row.speed && prev.band == row.band)
        {
            prev.white += row.white;
            prev.draws += row.draws;
            prev.black += row.black;
            if prev.san.is_empty() {
                prev.san = row.san.clone();
            }
        } else {
            out.push(row.clone());
        }
    }
    out
}

fn write_run(dir: &Path, index: usize, batch: &mut Batch) -> PathBuf {
    {
        let Batch { buf, rows } = &mut *batch;
        rows.sort_unstable_by(|a, b| {
            slice(buf, a.fen_off, a.fen_len)
                .cmp(slice(buf, b.fen_off, b.fen_len))
                .then_with(|| {
                    slice(buf, a.uci_off, a.uci_len).cmp(slice(buf, b.uci_off, b.uci_len))
                })
        });
    }
    let path = dir.join(format!("run-{index:05}.bin"));
    let file = File::create(&path).expect("create run");
    let mut out = BufWriter::with_capacity(1 << 20, file);
    for rec in &batch.rows {
        write_str(&mut out, slice(&batch.buf, rec.speed_off, rec.speed_len));
        write_str(&mut out, slice(&batch.buf, rec.band_off, rec.band_len));
        write_str(&mut out, slice(&batch.buf, rec.fen_off, rec.fen_len));
        write_str(&mut out, slice(&batch.buf, rec.uci_off, rec.uci_len));
        write_str(&mut out, slice(&batch.buf, rec.san_off, rec.san_len));
        out.write_all(&rec.white.to_le_bytes()).expect("write");
        out.write_all(&rec.draws.to_le_bytes()).expect("write");
        out.write_all(&rec.black.to_le_bytes()).expect("write");
    }
    out.flush().expect("flush run");
    batch.buf.clear();
    batch.rows.clear();
    path
}

impl Batch {
    fn try_push(
        &mut self,
        speed: &str,
        band: &str,
        fen: &str,
        uci: &str,
        san: &str,
        white: i64,
        draws: i64,
        black: i64,
    ) -> bool {
        let bytes = speed.len() + band.len() + fen.len() + uci.len() + san.len();
        if !self.rows.is_empty() && (self.rows.len() >= MAX_ROWS || self.buf.len() + bytes > MAX_BYTES)
        {
            return false;
        }
        let (speed_off, speed_len) = push_str(&mut self.buf, speed);
        let (band_off, band_len) = push_str(&mut self.buf, band);
        let (fen_off, fen_len) = push_str(&mut self.buf, fen);
        let (uci_off, uci_len) = push_str(&mut self.buf, uci);
        let (san_off, san_len) = push_str(&mut self.buf, san);
        self.rows.push(Rec {
            speed_off,
            speed_len,
            band_off,
            band_len,
            fen_off,
            fen_len,
            uci_off,
            uci_len,
            san_off,
            san_len,
            white,
            draws,
            black,
        });
        true
    }
}

impl Source {
    fn open(runs: &[PathBuf]) -> Self {
        let mut readers = Vec::with_capacity(runs.len());
        let mut heap = BinaryHeap::new();
        for (index, path) in runs.iter().enumerate() {
            let mut reader = RunReader {
                file: BufReader::with_capacity(1 << 20, File::open(path).expect("open run")),
            };
            if let Some(row) = reader.next_row() {
                heap.push(Item {
                    run: index as u32,
                    row,
                });
            }
            readers.push(reader);
        }
        Self {
            readers,
            heap,
            pending: None,
        }
    }

    fn pop(&mut self) -> Option<Owned> {
        let item = self.heap.pop()?;
        let index = item.run as usize;
        if let Some(row) = self.readers[index].next_row() {
            self.heap.push(Item {
                run: item.run,
                row,
            });
        }
        Some(item.row)
    }

    fn next_group(&mut self) -> Option<Vec<Owned>> {
        let first = self.pending.take().or_else(|| self.pop())?;
        let mut group = vec![first];
        loop {
            let Some(row) = self.pop() else {
                break;
            };
            if row.fen == group[0].fen && row.uci == group[0].uci {
                group.push(row);
            } else {
                self.pending = Some(row);
                break;
            }
        }
        Some(group)
    }
}

impl RunReader {
    fn next_row(&mut self) -> Option<Owned> {
        let speed = read_str(&mut self.file)?;
        let band = read_str(&mut self.file).expect("band");
        let fen = read_str(&mut self.file).expect("fen");
        let uci = read_str(&mut self.file).expect("uci");
        let san = read_str(&mut self.file).expect("san");
        let white = read_i64(&mut self.file).expect("white");
        let draws = read_i64(&mut self.file).expect("draws");
        let black = read_i64(&mut self.file).expect("black");
        Some(Owned {
            speed,
            band,
            fen,
            uci,
            san,
            white,
            draws,
            black,
        })
    }
}

fn write_str(out: &mut impl Write, bytes: &[u8]) {
    let len = u16::try_from(bytes.len()).expect("field too long");
    out.write_all(&len.to_le_bytes()).expect("write");
    out.write_all(bytes).expect("write");
}

fn read_str(input: &mut impl Read) -> Option<String> {
    let mut len_buf = [0u8; 2];
    match input.read(&mut len_buf) {
        Ok(0) => return None,
        Ok(1) => {
            input.read_exact(&mut len_buf[1..]).expect("len");
        }
        Ok(2) => {}
        Ok(_) => unreachable!(),
        Err(err) => panic!("read len: {err}"),
    }
    let len = u16::from_le_bytes(len_buf) as usize;
    let mut buf = vec![0u8; len];
    if len > 0 {
        input.read_exact(&mut buf).expect("field");
    }
    Some(String::from_utf8(buf).expect("utf8"))
}

fn read_i64(input: &mut impl Read) -> io::Result<i64> {
    let mut buf = [0u8; 8];
    input.read_exact(&mut buf)?;
    Ok(i64::from_le_bytes(buf))
}

fn slice(buf: &[u8], off: u32, len: u16) -> &[u8] {
    let start = off as usize;
    &buf[start..start + len as usize]
}

fn push_str(buf: &mut Vec<u8>, text: &str) -> (u32, u16) {
    let off = u32::try_from(buf.len()).expect("batch too large");
    let len = u16::try_from(text.len()).expect("field too long");
    buf.extend_from_slice(text.as_bytes());
    (off, len)
}

fn tune(db: &Connection) {
    db.execute_batch(
        "PRAGMA journal_mode = OFF;
         PRAGMA synchronous = OFF;
         PRAGMA locking_mode = EXCLUSIVE;
         PRAGMA temp_store = FILE;
         PRAGMA cache_size = -65536;
         PRAGMA mmap_size = 0;
         PRAGMA threads = 1;",
    )
    .expect("pragmas");
}

fn table_exists(db: &Connection, name: &str) -> bool {
    db.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |_| Ok(()),
    )
    .is_ok()
}

fn max_rowid(db: &Connection, table: &str) -> i64 {
    db.query_row(&format!("SELECT IFNULL(MAX(rowid), 0) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap_or(0)
}

fn rename_kept(db: &Connection, kept: &str, live: &str) {
    db.execute_batch(&format!("ALTER TABLE {kept} RENAME TO {live}"))
        .expect("rename kept");
}

fn report(table: &str, rows: u64, estimate: i64, runs: &[PathBuf], started: Instant) {
    let secs = started.elapsed().as_secs_f64().max(0.001);
    log(format!(
        "{{\"pass\":\"group\",\"table\":\"{table}\",\"rows\":{rows},\"of\":{estimate},\"runs\":{},\"perSec\":{:.0},\"rssMb\":{}}}",
        runs.len(),
        rows as f64 / secs,
        rss_mb()
    ));
}

fn spawn_pulse(progress: Arc<Progress>, path: PathBuf) -> Pulse {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let handle = thread::spawn(move || {
        while !flag.load(AtomicOrdering::Relaxed) {
            for _ in 0..15 {
                if flag.load(AtomicOrdering::Relaxed) {
                    return;
                }
                thread::sleep(Duration::from_secs(2));
            }
            let bytes = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
            log(format!(
                "{{\"pass\":\"group\",\"pulse\":true,\"rows\":{},\"kept\":{},\"runs\":{},\"rssMb\":{},\"bytes\":{bytes}}}",
                progress.rows.load(AtomicOrdering::Relaxed),
                progress.kept.load(AtomicOrdering::Relaxed),
                progress.runs.load(AtomicOrdering::Relaxed),
                rss_mb()
            ));
        }
    });
    Pulse {
        stop,
        handle: Some(handle),
    }
}

fn rss_mb() -> u64 {
    let text = fs::read_to_string("/proc/self/status").unwrap_or_default();
    for line in text.lines() {
        let Some(rest) = line.strip_prefix("VmRSS:") else {
            continue;
        };
        let kb: u64 = rest.split_whitespace().next().unwrap_or("0").parse().unwrap_or(0);
        return kb / 1024;
    }
    0
}

fn log(line: String) {
    println!("{line}");
    let _ = io::stdout().flush();
}
