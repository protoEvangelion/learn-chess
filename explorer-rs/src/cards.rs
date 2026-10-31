//! One card per board for a single month.
//!
//! The key is the 12-byte board hash. The file name is the month.
//! The value is the next ply only: a 2-byte move, then the speed and rating
//! bands that happened, each with white / draw / black counts.

use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, BufWriter, Read, Write};
use std::os::unix::fs::FileExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::Arc;
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crossbeam_channel::{bounded, Receiver, Sender};
use redb::{Database, Durability, ReadableTableMetadata, TableDefinition};
use rustc_hash::FxHashMap;
use shakmaty::fen::Fen;
use shakmaty::san::San;
use shakmaty::uci::UciMove;
use shakmaty::{CastlingMode, Chess, EnPassantMode, Position, Role, Square};

const CARDS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("cards");
const SPEEDS: [&str; 6] = [
    "ultraBullet",
    "bullet",
    "blitz",
    "rapid",
    "classical",
    "correspondence",
];
const BANDS: [i32; 9] = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];

pub fn stat(data: &Path) {
    let mut files: Vec<_> = fs::read_dir(data)
        .expect("read card dir")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("redb"))
        .collect();
    files.sort();
    for path in files {
        let db = Database::open(&path).expect("open card db");
        let txn = db.begin_read().expect("read cards");
        let table = txn.open_table(CARDS).expect("open cards");
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("?");
        println!("{name} cards={}", table.len().expect("count cards"));
    }
}

pub fn run(file: &Path, data: &Path, limit: u64, chunk_games: u64) {
    let month = month_of(file);
    let month_name = month.clone();
    let done = data.join(format!("{month}.done"));
    if done.exists() {
        println!("CARDS_SKIP {month}");
        return;
    }
    let db_path = data.join(format!("{month}.redb"));
    let runs = list_runs(data, &month);
    if !runs.is_empty() {
        println!("CARDS_RESUME_RUNS {month} files={}", runs.len());
        let _ = std::io::stdout().flush();
        for path in list_stage(data, &month, "merge") {
            let _ = fs::remove_file(path);
        }
        if db_path.exists() {
            fs::remove_file(&db_path).expect("remove partial kv db");
        }
        let started = Instant::now();
        let runs = collapse_runs(runs, data, &month);
        write_db(&runs, &db_path, &month);
        for path in runs {
            let _ = fs::remove_file(path);
        }
        fs::write(&done, "").expect("mark month done");
        println!(
            "CARDS_MONTH_DONE {month} seconds={}",
            started.elapsed().as_secs()
        );
        return;
    }
    let merges = list_stage(data, &month, "merge");
    if !merges.is_empty() {
        println!(
            "CARDS_RESUME {month} files={}",
            merges.len()
        );
        let _ = std::io::stdout().flush();
        if db_path.exists() {
            fs::remove_file(&db_path).expect("remove partial card db");
        }
        let started = Instant::now();
        write_db(&merges, &db_path, &month);
        for path in merges {
            let _ = fs::remove_file(path);
        }
        fs::write(&done, "").expect("mark month done");
        println!(
            "CARDS_MONTH_DONE {month} seconds={}",
            started.elapsed().as_secs()
        );
        return;
    }
    clear_partial(data, &month, &db_path);
    let chunk = chunk_games.clamp(10_000, 200_000);
    let games = Arc::new(AtomicU64::new(0));
    let spills = Arc::new(AtomicU64::new(0));
    let started = Instant::now();
    let workers = thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    println!(
        "{{\"cards\":true,\"write\":\"once\",\"month\":\"{month}\",\"chunk\":{chunk},\"workers\":{workers}}}"
    );
    let progress = data.join("progress.json");
    let (tx, rx) = bounded::<String>(workers * 2);
    thread::scope(|scope| {
        scope.spawn(|| stream_games(file, limit, tx));
        for _ in 0..workers {
            let rx = rx.clone();
            let games = Arc::clone(&games);
            let spills = Arc::clone(&spills);
            let month = month.clone();
            let progress = progress.clone();
            let data = data.to_path_buf();
            scope.spawn(move || worker(rx, &data, spills, games, chunk, &month, &progress, started));
        }
    });
    let runs = list_runs(data, &month_name);
    println!(
        "CARDS_MERGE {month_name} runs={} seconds={}",
        runs.len(),
        started.elapsed().as_secs()
    );
    let runs = collapse_runs(runs, data, &month_name);
    write_db(&runs, &db_path, &month_name);
    for path in runs {
        let _ = fs::remove_file(path);
    }
    fs::write(&done, "").expect("mark month done");
    println!(
        "CARDS_MONTH_DONE {month_name} games={} seconds={}",
        games.load(AtomicOrdering::Relaxed),
        started.elapsed().as_secs()
    );
}

fn worker(
    rx: Receiver<String>,
    data: &Path,
    spills: Arc<AtomicU64>,
    games: Arc<AtomicU64>,
    chunk: u64,
    month: &str,
    progress: &Path,
    started: Instant,
) {
    let mut map: FxHashMap<[u8; 16], [u32; 3]> = FxHashMap::default();
    let mut cleaned = String::new();
    let mut local = 0u64;
    while let Ok(game) = rx.recv() {
        if let Some(kept) = consider(&game) {
            walk(&kept, &mut cleaned, &mut map);
        }
        local += 1;
        let seen = games.fetch_add(1, AtomicOrdering::Relaxed) + 1;
        if seen % 100_000 == 0 {
            write_progress(progress, month, seen, started);
            println!(
                "{{\"cards_games\":{seen},\"month\":\"{month}\",\"seconds\":{}}}",
                started.elapsed().as_secs()
            );
            let _ = std::io::stdout().flush();
        }
        if local >= chunk {
            spill(data, month, &spills, &mut map);
            local = 0;
        }
    }
    if !map.is_empty() {
        spill(data, month, &spills, &mut map);
    }
}

fn write_progress(path: &Path, month: &str, games: u64, started: Instant) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let body = format!(
        "{{\"month\":\"{month}\",\"games\":{games},\"seconds\":{},\"unix\":{now}}}\n",
        started.elapsed().as_secs()
    );
    let _ = fs::write(path, body);
}

fn clear_partial(data: &Path, month: &str, db_path: &Path) {
    if db_path.exists() {
        fs::remove_file(db_path).expect("remove partial month");
    }
    let Ok(entries) = fs::read_dir(data) else {
        return;
    };
    let run_prefix = format!("{month}-run-");
    let merge_prefix = format!("{month}-merge-");
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(&run_prefix) || name.starts_with(&merge_prefix) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn spill(
    data: &Path,
    month: &str,
    spills: &AtomicU64,
    map: &mut FxHashMap<[u8; 16], [u32; 3]>,
) {
    if map.is_empty() {
        return;
    }
    let mut rows: Vec<([u8; 16], [u32; 3])> = map.drain().collect();
    rows.sort_unstable_by(|a, b| a.0.cmp(&b.0));
    let n = spills.fetch_add(1, AtomicOrdering::Relaxed);
    let path = data.join(format!("{month}-run-{n:05}.bin"));
    let mut out = BufWriter::new(File::create(&path).expect("create run"));
    for (key, counts) in &rows {
        out.write_all(key).expect("write run");
        for count in counts {
            out.write_all(&count.to_le_bytes()).expect("write run");
        }
    }
    out.flush().expect("flush run");
    println!(
        "{{\"cards_spill\":{n},\"rows\":{},\"month\":\"{month}\"}}",
        rows.len()
    );
    let _ = std::io::stdout().flush();
}

fn list_runs(data: &Path, month: &str) -> Vec<PathBuf> {
    list_stage(data, month, "run")
}

fn list_stage(data: &Path, month: &str, kind: &str) -> Vec<PathBuf> {
    let prefix = format!("{month}-{kind}-");
    let mut runs: Vec<_> = fs::read_dir(data)
        .expect("read runs")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(&prefix) && name.ends_with(".bin"))
        })
        .collect();
    runs.sort();
    runs
}

fn collapse_runs(mut runs: Vec<PathBuf>, data: &Path, month: &str) -> Vec<PathBuf> {
    let mut round = 0usize;
    while runs.len() > 48 {
        println!("CARDS_COLLAPSE {month} files={} round={round}", runs.len());
        let mut next = Vec::new();
        for (index, chunk) in runs.chunks(48).enumerate() {
            let path = data.join(format!("{month}-merge-{round:02}-{index:04}.bin"));
            merge_to_file(chunk, &path);
            next.push(path);
        }
        for path in &runs {
            let _ = fs::remove_file(path);
        }
        runs = next;
        round += 1;
    }
    runs
}

fn merge_to_file(runs: &[PathBuf], dest: &Path) {
    let mut merger = Merger::open(runs);
    let mut out = BufWriter::new(File::create(dest).expect("create merge"));
    while let Some((key, counts)) = merger.next_summed() {
        out.write_all(&key).expect("write merge");
        for count in counts {
            out.write_all(&count.to_le_bytes()).expect("write merge");
        }
    }
    out.flush().expect("flush merge");
}

fn write_db(runs: &[PathBuf], db_path: &Path, month: &str) {
    if db_path.exists() {
        fs::remove_file(db_path).expect("replace card db");
    }
    let db = Database::builder()
        .set_cache_size(512 * 1024 * 1024)
        .create(db_path)
        .expect("create card db");
    let month_bytes = pack_month(month).to_le_bytes();
    let mut merger = Merger::open(runs);
    let mut group: Vec<([u8; 16], [u32; 3])> = Vec::new();
    let mut written = 0u64;
    let mut txn = db.begin_write().expect("card write");
    txn.set_durability(Durability::Eventual);
    let mut table = txn.open_table(CARDS).expect("open cards");
    let mut pending = 0usize;
    while let Some((key, counts)) = merger.next_summed() {
        if group.first().is_some_and(|row| row.0[..12] != key[..12]) {
            insert_group(&mut table, &month_bytes, &group);
            group.clear();
            written += 1;
            pending += 1;
            if pending == 50_000 {
                drop(table);
                txn.commit().expect("commit cards");
                txn = db.begin_write().expect("card write");
                txn.set_durability(Durability::Eventual);
                table = txn.open_table(CARDS).expect("open cards");
                pending = 0;
                println!("{{\"cards_written\":{written},\"month\":\"{month}\"}}");
                let _ = std::io::stdout().flush();
            }
        }
        group.push((key, counts));
    }
    if !group.is_empty() {
        insert_group(&mut table, &month_bytes, &group);
        written += 1;
    }
    drop(table);
    txn.set_durability(Durability::Immediate);
    txn.commit().expect("commit cards");
    println!("CARDS_DB {month} cards={written}");
}

fn insert_group(
    table: &mut redb::Table<'_, &[u8], &[u8]>,
    month_bytes: &[u8; 2],
    group: &[([u8; 16], [u32; 3])],
) {
    let blob = encode(group);
    let mut key = [0u8; 14];
    key[..12].copy_from_slice(&group[0].0[..12]);
    key[12..].copy_from_slice(month_bytes);
    table
        .insert(key.as_slice(), blob.as_slice())
        .expect("write card");
}

struct HeapItem {
    key: [u8; 16],
    counts: [u32; 3],
    src: usize,
}

impl PartialEq for HeapItem {
    fn eq(&self, other: &Self) -> bool {
        self.key == other.key && self.src == other.src
    }
}

impl Eq for HeapItem {}

impl PartialOrd for HeapItem {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for HeapItem {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .key
            .cmp(&self.key)
            .then_with(|| other.src.cmp(&self.src))
    }
}

struct RunReader {
    file: BufReader<File>,
}

impl RunReader {
    fn next_rec(&mut self) -> Option<([u8; 16], [u32; 3])> {
        let mut key = [0u8; 16];
        let mut raw = [0u8; 12];
        if self.file.read_exact(&mut key).is_err() {
            return None;
        }
        self.file.read_exact(&mut raw).expect("short run");
        Some((
            key,
            [
                u32::from_le_bytes(raw[0..4].try_into().unwrap()),
                u32::from_le_bytes(raw[4..8].try_into().unwrap()),
                u32::from_le_bytes(raw[8..12].try_into().unwrap()),
            ],
        ))
    }
}

struct Merger {
    readers: Vec<RunReader>,
    heap: BinaryHeap<HeapItem>,
}

impl Merger {
    fn open(runs: &[PathBuf]) -> Self {
        let mut readers = Vec::with_capacity(runs.len());
        let mut heap = BinaryHeap::new();
        for path in runs {
            let mut reader = RunReader {
                file: BufReader::with_capacity(1 << 20, File::open(path).expect("open run")),
            };
            if let Some((key, counts)) = reader.next_rec() {
                let src = readers.len();
                heap.push(HeapItem { key, counts, src });
            }
            readers.push(reader);
        }
        Self { readers, heap }
    }

    fn next_summed(&mut self) -> Option<([u8; 16], [u32; 3])> {
        let item = self.heap.pop()?;
        let key = item.key;
        let mut counts = item.counts;
        self.refill(item.src);
        while self.heap.peek().is_some_and(|next| next.key == key) {
            let more = self.heap.pop().expect("heap item");
            counts[0] = counts[0].saturating_add(more.counts[0]);
            counts[1] = counts[1].saturating_add(more.counts[1]);
            counts[2] = counts[2].saturating_add(more.counts[2]);
            self.refill(more.src);
        }
        Some((key, counts))
    }

    fn refill(&mut self, src: usize) {
        if let Some((key, counts)) = self.readers[src].next_rec() {
            self.heap.push(HeapItem { key, counts, src });
        }
    }
}

fn encode(rows: &[([u8; 16], [u32; 3])]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut index = 0;
    while index < rows.len() {
        let mv = u16::from_le_bytes([rows[index].0[12], rows[index].0[13]]);
        let end = rows[index + 1..]
            .iter()
            .position(|row| row.0[12] != rows[index].0[12] || row.0[13] != rows[index].0[13])
            .map(|offset| index + 1 + offset)
            .unwrap_or(rows.len());
        out.extend_from_slice(&mv.to_le_bytes());
        out.push((end - index) as u8);
        for row in &rows[index..end] {
            out.push(row.0[14]);
            for count in row.1 {
                out.extend_from_slice(&count.to_le_bytes());
            }
        }
        index = end;
    }
    out
}

fn decode(buf: &[u8]) -> Vec<(u16, u8, [u32; 3])> {
    let mut rows = Vec::new();
    let mut i = 0;
    while i + 3 <= buf.len() {
        let mv = u16::from_le_bytes([buf[i], buf[i + 1]]);
        let n = buf[i + 2] as usize;
        i += 3;
        for _ in 0..n {
            if i + 13 > buf.len() {
                return rows;
            }
            let cell = buf[i];
            let white = u32::from_le_bytes(buf[i + 1..i + 5].try_into().unwrap());
            let draws = u32::from_le_bytes(buf[i + 5..i + 9].try_into().unwrap());
            let black = u32::from_le_bytes(buf[i + 9..i + 13].try_into().unwrap());
            rows.push((mv, cell, [white, draws, black]));
            i += 13;
        }
    }
    rows
}

fn merge_blobs(left: &[u8], right: &[u8]) -> Vec<u8> {
    let mut rows = decode(left);
    rows.extend(decode(right));
    rows.sort_unstable_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));
    let mut raw: Vec<([u8; 16], [u32; 3])> = Vec::new();
    for (mv, cell, counts) in rows {
        if let Some(prev) = raw.last_mut() {
            if prev.0[12..14] == mv.to_le_bytes() && prev.0[14] == cell {
                prev.1[0] = prev.1[0].saturating_add(counts[0]);
                prev.1[1] = prev.1[1].saturating_add(counts[1]);
                prev.1[2] = prev.1[2].saturating_add(counts[2]);
                continue;
            }
        }
        let mut key = [0u8; 16];
        key[12..14].copy_from_slice(&mv.to_le_bytes());
        key[14] = cell;
        raw.push((key, counts));
    }
    encode(&raw)
}

struct Kept<'a> {
    speed: u8,
    band: u8,
    outcome: usize,
    body: &'a str,
}

fn consider(game: &str) -> Option<Kept<'_>> {
    let split = game.find("\n\n")?;
    let mut result = "";
    let mut white_elo = "";
    let mut black_elo = "";
    let mut time_control = "";
    let mut white_title = "";
    let mut black_title = "";
    let mut variant = "";
    for line in game[..split].lines() {
        let Some(key_end) = line.find(' ') else {
            continue;
        };
        if !line.starts_with('[') {
            continue;
        }
        let key = &line[1..key_end];
        let value = header_value(line);
        match key {
            "Result" => result = value,
            "WhiteElo" => white_elo = value,
            "BlackElo" => black_elo = value,
            "TimeControl" => time_control = value,
            "WhiteTitle" => white_title = value,
            "BlackTitle" => black_title = value,
            "Variant" => variant = value,
            _ => {}
        }
    }
    if !variant.is_empty() && variant != "Standard" {
        return None;
    }
    if white_title == "BOT" || black_title == "BOT" {
        return None;
    }
    let outcome = match result {
        "1-0" => 0,
        "1/2-1/2" => 1,
        "0-1" => 2,
        _ => return None,
    };
    let white: i32 = white_elo.parse().ok()?;
    let black: i32 = black_elo.parse().ok()?;
    Some(Kept {
        speed: speed_of(time_control)?,
        band: band_of((white + black) / 2),
        outcome,
        body: &game[split + 2..],
    })
}

fn speed_of(time_control: &str) -> Option<u8> {
    if time_control.contains('/') {
        return Some(5);
    }
    let (base, inc) = time_control.split_once('+')?;
    let base: i32 = base.parse().ok()?;
    let inc: i32 = inc.parse().ok()?;
    let total = base + 40 * inc;
    Some(if total < 30 {
        0
    } else if total < 180 {
        1
    } else if total < 480 {
        2
    } else if total < 1500 {
        3
    } else {
        4
    })
}

fn band_of(avg: i32) -> u8 {
    let mut band = 0u8;
    for (index, floor) in BANDS.iter().enumerate() {
        if avg >= *floor {
            band = index as u8;
        }
    }
    band
}

fn walk(kept: &Kept<'_>, cleaned: &mut String, map: &mut FxHashMap<[u8; 16], [u32; 3]>) {
    clean_body(kept.body, cleaned);
    let mut pos = Chess::default();
    for token in cleaned.split_whitespace() {
        if is_skippable(token) {
            continue;
        }
        let written = token.trim_end_matches(['!', '?']);
        let Some(mv) = San::from_ascii(written.as_bytes())
            .ok()
            .and_then(|san| san.to_move(&pos).ok())
        else {
            return;
        };
        let Some(packed) = pack_move(&mv) else {
            return;
        };
        let hash = board_hash(&pos);
        let mut key = [0u8; 16];
        key[..12].copy_from_slice(&hash);
        key[12..14].copy_from_slice(&packed.to_le_bytes());
        key[14] = kept.speed * 9 + kept.band;
        let cell = map.entry(key).or_insert([0, 0, 0]);
        cell[kept.outcome] = cell[kept.outcome].saturating_add(1);
        pos.play_unchecked(mv);
    }
}

fn pack_move(mv: &shakmaty::Move) -> Option<u16> {
    match UciMove::from_standard(*mv) {
        UciMove::Normal { from, to, promotion } => {
            let promo = promotion.map(u16::from).unwrap_or(0);
            Some((from.to_u32() as u16) | ((to.to_u32() as u16) << 6) | (promo << 12))
        }
        _ => None,
    }
}

fn board_hash(pos: &Chess) -> [u8; 12] {
    let board = pos.board();
    let ep = pos
        .ep_square(EnPassantMode::Legal)
        .map(|sq| sq.to_u32() as u64 + 1)
        .unwrap_or(0);
    let turn = if pos.turn().is_white() { 1u64 } else { 2 };
    let mut h1 = 0x243f6a8885a308d3u64;
    let mut h2 = 0x13198a2e03707344u64;
    for part in [
        board.pawns().0,
        board.knights().0,
        board.bishops().0,
        board.rooks().0,
        board.queens().0,
        board.kings().0,
        board.white().0,
        pos.castles().castling_rights().0,
        ep,
        turn,
    ] {
        h1 = h1.wrapping_mul(0x100000001b3) ^ part;
        h2 = h2.wrapping_mul(0xc2b2ae3d27d4eb4f) ^ part.rotate_left(17);
    }
    h2 |= 1;
    let mut out = [0u8; 12];
    out[..8].copy_from_slice(&h1.to_le_bytes());
    out[8..].copy_from_slice(&h2.to_le_bytes()[..4]);
    out
}

fn pack_month(month: &str) -> u16 {
    let year: u16 = month[..4].parse().unwrap_or(2026);
    let mm: u16 = month[5..7].parse().unwrap_or(9);
    (year - 2000) * 12 + (mm - 1)
}

fn month_of(file: &Path) -> String {
    let name = file.file_name().and_then(|value| value.to_str()).unwrap_or("");
    name.split(|ch: char| ch != '-' && !ch.is_ascii_digit())
        .find(|part| part.len() == 7 && part.as_bytes().get(4) == Some(&b'-'))
        .unwrap_or("2026-09")
        .to_owned()
}

fn header_value(line: &str) -> &str {
    let Some(start) = line.find('"') else {
        return "";
    };
    let rest = &line[start + 1..];
    match rest.find('"') {
        Some(end) => &rest[..end],
        None => rest,
    }
}

fn clean_body(body: &str, out: &mut String) {
    out.clear();
    let bytes = body.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'{' => {
                i += 1;
                while i < bytes.len() && bytes[i] != b'}' {
                    i += 1;
                }
                if i < bytes.len() {
                    i += 1;
                }
                out.push(' ');
            }
            b';' => {
                i += 1;
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b => {
                out.push(b as char);
                i += 1;
            }
        }
    }
}

fn is_skippable(token: &str) -> bool {
    if token.is_empty() || token == "1-0" || token == "0-1" || token == "1/2-1/2" || token == "*" {
        return true;
    }
    let bare = token.trim_end_matches('.');
    !bare.is_empty() && bare.bytes().all(|byte| byte.is_ascii_digit())
}

fn stream_games(file: &Path, limit: u64, tx: Sender<String>) {
    if file.to_string_lossy().ends_with(".pgn") {
        let reader = File::open(file).expect("open pgn");
        pump(reader, limit, tx, None);
        return;
    }
    let mut child = Command::new("zstd")
        .args(["-dc", "-T0", &file.to_string_lossy()])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn zstd");
    let stdout = child.stdout.take().expect("zstd stdout");
    pump(stdout, limit, tx, Some(&mut child));
    let _ = child.wait();
}

fn pump(mut reader: impl Read, limit: u64, tx: Sender<String>, mut child: Option<&mut Child>) {
    let mut buf = Vec::with_capacity(1 << 20);
    let mut tmp = vec![0u8; 1 << 20];
    let mut games = 0u64;
    loop {
        if limit > 0 && games >= limit {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
            }
            break;
        }
        let n = reader.read(&mut tmp).expect("read pgn");
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
        while let Some(end) = buf.windows(3).position(|window| window == b"\n\n[") {
            if limit > 0 && games >= limit {
                break;
            }
            let game = String::from_utf8_lossy(&buf[..end]).into_owned();
            buf.drain(..end + 2);
            if game.starts_with('[') {
                games += 1;
                if tx.send(game).is_err() {
                    if let Some(child) = child.as_mut() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                    return;
                }
            }
        }
        if limit > 0 && games >= limit {
            break;
        }
    }
    if buf.starts_with(b"[") && (limit == 0 || games < limit) {
        let game = String::from_utf8_lossy(&buf).into_owned();
        let _ = tx.send(game);
    }
}

#[allow(dead_code)]
fn speed_name(index: u8) -> &'static str {
    SPEEDS.get(index as usize).copied().unwrap_or("blitz")
}

struct CardFile {
    month_bytes: [u8; 2],
    db: Database,
}

/// Keeps finished month files open and answers one board per stdin line.
///
/// A line is `Q`, the FEN, UCI moves from that FEN, speed names, rating
/// floors, and `YYYY-MM` months, separated by tabs. The reply is one JSON
/// object. Node cannot read this file itself, so the website talks to this
/// process.
pub fn serve(data: &Path) {
    let files = open_finished(data);
    eprintln!("CARDS_SERVE files={}", files.len());
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(err) => {
                println!("{{\"error\":\"{err}\"}}");
                let _ = io::stdout().flush();
                continue;
            }
        };
        if line.is_empty() {
            continue;
        }
        println!("{}", answer_line(&files, &line));
        let _ = io::stdout().flush();
    }
}

fn open_finished(data: &Path) -> Vec<CardFile> {
    let mut names: Vec<String> = fs::read_dir(data)
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok())
                .filter_map(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    name.strip_suffix(".done").map(str::to_owned)
                })
                .filter(|month| data.join(format!("{month}.redb")).is_file())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    let files: Vec<CardFile> = names
        .iter()
        .filter_map(|month| {
            let path = data.join(format!("{month}.redb"));
            match Database::builder()
                .set_cache_size(64 * 1024 * 1024)
                .open(&path)
            {
                Ok(db) => Some(CardFile {
                    month_bytes: pack_month(month).to_le_bytes(),
                    db,
                }),
                Err(err) => {
                    eprintln!("CARDS_OPEN_FAIL {month} {err}");
                    None
                }
            }
        })
        .collect();
    if !names.is_empty() && files.is_empty() {
        eprintln!("CARDS_SERVE open failed");
        std::process::exit(1);
    }
    files
}

fn answer_line(files: &[CardFile], line: &str) -> String {
    let mut parts = line.split('\t');
    if parts.next() != Some("Q") {
        return "{\"error\":\"bad query\"}".to_owned();
    }
    let fen = parts.next().unwrap_or("");
    let play = parts.next().unwrap_or("");
    let speeds = parts.next().unwrap_or("");
    let ratings = parts.next().unwrap_or("");
    let months = parts.next().unwrap_or("");
    match query_position(files, fen, play, speeds, ratings, months) {
        Ok(body) => body,
        Err(err) => format!("{{\"error\":\"{}\"}}", json_escape(&err)),
    }
}

fn query_position(
    files: &[CardFile],
    fen: &str,
    play: &str,
    speeds: &str,
    ratings: &str,
    months: &str,
) -> Result<String, String> {
    let pos = position_after(fen, play)?;
    let hash = board_hash(&pos);
    let speed_on = speed_mask(speeds);
    let band_on = band_mask(ratings);
    let month_filter: Vec<[u8; 2]> = months
        .split(',')
        .filter(|month| !month.is_empty())
        .map(|month| pack_month(month).to_le_bytes())
        .collect();
    let mut totals = FxHashMap::<u16, [u32; 3]>::default();
    for file in files {
        if !month_filter.is_empty() && !month_filter.iter().any(|month| month == &file.month_bytes) {
            continue;
        }
        for (mv, cell, counts) in lookup(file, &hash)? {
            let speed = cell / 9;
            let band = cell % 9;
            if speed > 5 || !speed_on[speed as usize] || !band_on[band as usize] {
                continue;
            }
            let row = totals.entry(mv).or_insert([0, 0, 0]);
            row[0] = row[0].saturating_add(counts[0]);
            row[1] = row[1].saturating_add(counts[1]);
            row[2] = row[2].saturating_add(counts[2]);
        }
    }
    let mut moves: Vec<(u16, [u32; 3])> = totals.into_iter().collect();
    moves.sort_by(|a, b| {
        let games = |counts: [u32; 3]| counts[0] + counts[1] + counts[2];
        games(b.1).cmp(&games(a.1)).then(a.0.cmp(&b.0))
    });
    let mut white = 0u64;
    let mut draws = 0u64;
    let mut black = 0u64;
    let mut body = String::from("{\"white\":");
    let mut listed = String::new();
    let mut first = true;
    for (packed, counts) in moves {
        let games = u64::from(counts[0]) + u64::from(counts[1]) + u64::from(counts[2]);
        if games == 0 {
            continue;
        }
        let Some((uci, san)) = move_names(&pos, packed) else {
            continue;
        };
        white += u64::from(counts[0]);
        draws += u64::from(counts[1]);
        black += u64::from(counts[2]);
        if !first {
            listed.push(',');
        }
        first = false;
        listed.push_str(&format!(
            "{{\"uci\":\"{}\",\"san\":\"{}\",\"white\":{},\"draws\":{},\"black\":{}{}}}",
            json_escape(&uci),
            json_escape(&san),
            counts[0],
            counts[1],
            counts[2],
            engine_suffix(&pos, packed),
        ));
    }
    body.push_str(&white.to_string());
    body.push_str(",\"draws\":");
    body.push_str(&draws.to_string());
    body.push_str(",\"black\":");
    body.push_str(&black.to_string());
    body.push_str(",\"moves\":[");
    body.push_str(&listed);
    body.push_str("]}");
    Ok(body)
}

fn lookup(file: &CardFile, hash: &[u8; 12]) -> Result<Vec<(u16, u8, [u32; 3])>, String> {
    let mut key = [0u8; 14];
    key[..12].copy_from_slice(hash);
    key[12..].copy_from_slice(&file.month_bytes);
    let txn = file.db.begin_read().map_err(|err| err.to_string())?;
    let table = txn.open_table(CARDS).map_err(|err| err.to_string())?;
    match table.get(key.as_slice()).map_err(|err| err.to_string())? {
        Some(value) => Ok(decode(value.value())),
        None => Ok(Vec::new()),
    }
}

fn position_after(fen: &str, play: &str) -> Result<Chess, String> {
    let setup = fen.parse::<Fen>().map_err(|err| err.to_string())?;
    let mut pos: Chess = setup
        .into_position(CastlingMode::Standard)
        .map_err(|err| err.to_string())?;
    if play.is_empty() {
        return Ok(pos);
    }
    for token in play.split(',') {
        let uci: UciMove = token.parse().map_err(|_| format!("uci {token}"))?;
        let mv = uci.to_move(&pos).map_err(|_| format!("illegal {token}"))?;
        pos.play_unchecked(mv);
    }
    Ok(pos)
}

fn move_names(pos: &Chess, packed: u16) -> Option<(String, String)> {
    let from = Square::new(u32::from(packed & 63));
    let to = Square::new(u32::from((packed >> 6) & 63));
    let promo = packed >> 12;
    let promotion = if promo == 0 {
        None
    } else {
        Role::try_from(promo).ok()
    };
    if promo != 0 && promotion.is_none() {
        return None;
    }
    let uci = UciMove::Normal {
        from,
        to,
        promotion,
    };
    let uci_text = uci.to_string();
    let mv = uci.to_move(pos).ok()?;
    let san = San::from_move(pos, mv).to_string();
    Some((uci_text, san))
}

fn speed_mask(speeds: &str) -> [bool; 6] {
    let mut mask = [false; 6];
    let mut any = false;
    for name in speeds.split(',').filter(|name| !name.is_empty()) {
        if let Some(index) = SPEEDS.iter().position(|speed| *speed == name) {
            mask[index] = true;
            any = true;
        }
    }
    if !any {
        mask = [true; 6];
    }
    mask
}

fn band_mask(ratings: &str) -> [bool; 9] {
    let mut mask = [false; 9];
    let mut any = false;
    for raw in ratings.split(',').filter(|raw| !raw.is_empty()) {
        let Ok(floor) = raw.parse::<i32>() else {
            continue;
        };
        if let Some(index) = BANDS.iter().position(|band| *band == floor) {
            mask[index] = true;
            any = true;
        }
    }
    if !any {
        mask = [true; 9];
    }
    mask
}

fn json_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

const EVAL_REC: u64 = 18;
const EVAL_HEADER: u64 = 16;

struct EvalFile {
    file: File,
    count: u64,
}

fn eval_index_path() -> PathBuf {
    std::env::var_os("EXPLORER_EVAL_INDEX")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/home/daisy/lichess-eval/eval-index.bin"))
}

fn eval_slot() -> &'static Mutex<Option<EvalFile>> {
    static SLOT: Mutex<Option<EvalFile>> = Mutex::new(None);
    &SLOT
}

/// Side file of Lichess scores, keyed by the same fingerprint as the month files.
/// A missing file means the column stays empty. The month files are not written.
fn lookup_eval(hash: &[u8; 12]) -> Option<(i16, i16, u16)> {
    let mut slot = eval_slot().lock().unwrap_or_else(|err| err.into_inner());
    if slot.is_none() {
        *slot = EvalFile::open(&eval_index_path());
    }
    slot.as_ref()?.find(hash)
}

impl EvalFile {
    fn open(path: &Path) -> Option<Self> {
        let file = File::open(path).ok()?;
        let mut header = [0u8; EVAL_HEADER as usize];
        file.read_exact_at(&mut header, 0).ok()?;
        if &header[..4] != b"LCE1" {
            return None;
        }
        let count = u64::from_le_bytes(header[4..12].try_into().ok()?);
        let rec = u16::from_le_bytes(header[12..14].try_into().ok()?);
        if u64::from(rec) != EVAL_REC || count == 0 {
            return None;
        }
        Some(Self { file, count })
    }

    fn find(&self, want: &[u8; 12]) -> Option<(i16, i16, u16)> {
        let mut lo = 0u64;
        let mut hi = self.count;
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            let mut buf = [0u8; EVAL_REC as usize];
            let offset = EVAL_HEADER + mid * EVAL_REC;
            self.file.read_exact_at(&mut buf, offset).ok()?;
            match buf[..12].cmp(want) {
                Ordering::Equal => {
                    let depth = u16::from_le_bytes(buf[12..14].try_into().ok()?);
                    let cp = i16::from_le_bytes(buf[14..16].try_into().ok()?);
                    let mate = i16::from_le_bytes(buf[16..18].try_into().ok()?);
                    return Some((cp, mate, depth));
                }
                Ordering::Less => lo = mid + 1,
                Ordering::Greater => hi = mid,
            }
        }
        None
    }
}

/// White's edge after this move, from the saved score of the resulting board.
fn engine_suffix(pos: &Chess, packed: u16) -> String {
    let Some((cp, mate, depth)) = engine_white(pos, packed) else {
        return String::new();
    };
    if mate != 0 {
        format!(",\"engineMate\":{mate},\"engineDepth\":{depth}")
    } else {
        format!(",\"engineCp\":{cp},\"engineDepth\":{depth}")
    }
}

fn engine_white(pos: &Chess, packed: u16) -> Option<(i16, i16, u16)> {
    let (uci, _) = move_names(pos, packed)?;
    let parsed: UciMove = uci.parse().ok()?;
    let mv = parsed.to_move(pos).ok()?;
    let mut child = pos.clone();
    child.play_unchecked(mv);
    let (cp, mate, depth) = lookup_eval(&board_hash(&child))?;
    let (cp, mate) = if child.turn().is_white() {
        (cp, mate)
    } else {
        (
            i16::try_from(i32::from(cp).saturating_neg()).unwrap_or(if cp < 0 {
                i16::MAX
            } else {
                i16::MIN
            }),
            i16::try_from(i32::from(mate).saturating_neg()).unwrap_or(0),
        )
    };
    Some((cp, mate, depth))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn e4_unpacks_to_san() {
        let pos = Chess::default();
        let packed = 12u16 | (28u16 << 6);
        let (uci, san) = move_names(&pos, packed).expect("e4");
        assert_eq!(uci, "e2e4");
        assert_eq!(san, "e4");
    }

    #[test]
    fn speeds_follow_lichess_cuts() {
        assert_eq!(speed_of("15+0"), Some(0));
        assert_eq!(speed_of("60+0"), Some(1));
        assert_eq!(speed_of("180+0"), Some(2));
        assert_eq!(speed_of("600+0"), Some(3));
        assert_eq!(speed_of("1800+0"), Some(4));
        assert_eq!(speed_of("1/86400"), Some(5));
    }

    #[test]
    fn merge_adds_the_same_reply() {
        let mut key = [0u8; 16];
        key[12] = 4;
        key[14] = 2 * 9 + 4;
        let blob = encode(&[ (key, [2, 1, 0]) ]);
        let merged = merge_blobs(&blob, &blob);
        let rows = decode(&merged);
        assert_eq!(rows, vec![(4, 2 * 9 + 4, [4, 2, 0])]);
    }

    #[test]
    fn known_board_fingerprint() {
        let pos = position_after(
            "7r/1p3k2/p1bPR3/5p2/2B2P1p/8/PP4P1/3K4 b - -",
            "",
        )
        .expect("fen");
        let hash = board_hash(&pos);
        let mut hex = String::new();
        for byte in hash {
            hex.push_str(&format!("{byte:02x}"));
        }
        assert_eq!(hex, "499cdf13bb1d9c0cc9833235");
    }

    #[test]
    fn eval_index_finds_the_middle_board() {
        let pos = Chess::default();
        let hash = board_hash(&pos);
        let path = std::env::temp_dir().join(format!("eval-index-test-{}", std::process::id()));
        let mut bytes = vec![0u8; EVAL_HEADER as usize];
        bytes[..4].copy_from_slice(b"LCE1");
        bytes[4..12].copy_from_slice(&1u64.to_le_bytes());
        bytes[12..14].copy_from_slice(&18u16.to_le_bytes());
        let mut rec = [0u8; 18];
        rec[..12].copy_from_slice(&hash);
        rec[12..14].copy_from_slice(&75u16.to_le_bytes());
        rec[14..16].copy_from_slice(&19i16.to_le_bytes());
        bytes.extend_from_slice(&rec);
        std::fs::write(&path, &bytes).unwrap();
        let file = EvalFile::open(&path).expect("index");
        assert_eq!(file.find(&hash), Some((19, 0, 75)));
        let mut missing = hash;
        missing[0] ^= 0xff;
        assert_eq!(file.find(&missing), None);
        std::fs::remove_file(&path).ok();
    }
}
