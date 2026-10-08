//! Count one Lichess month into explorer_position and explorer_move.
//!
//! Pass 1 remembers which boards and moves were popular, in a fixed-size sketch.
//! Pass 2 keeps one row per board: an 8-byte hash, the board text once, and a
//! win/draw/loss grid over speed and rating band. `--pass bench` times that map
//! against the old string keys. The website upload is still
//! `npm run build:explorer:upload`.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use crossbeam_channel::{bounded, Sender};
use rusqlite::Connection;
use rustc_hash::{FxHashMap, FxHashSet};
use shakmaty::san::San;
use shakmaty::uci::UciMove;
use shakmaty::{CastlingMode, CastlingSide, Chess, Color, EnPassantMode, Position};

const WIDTH: usize = 1 << 28;
const DEPTH: usize = 4;
const PLY_CAP: usize = 50;
const SKETCH_BYTES: usize = WIDTH * DEPTH * 2;
const BATCH: usize = 4096;
const SPEEDS: [&str; 3] = ["blitz", "rapid", "classical"];
const BANDS: [&str; 9] = [
    "0", "1000", "1200", "1400", "1600", "1800", "2000", "2200", "2500",
];

struct Sketch {
    cells: Vec<AtomicU16>,
}

impl Sketch {
    fn new() -> Self {
        Self {
            cells: (0..WIDTH * DEPTH).map(|_| AtomicU16::new(0)).collect(),
        }
    }

    fn add(&self, fen: &str, uci: Option<&str>) {
        let (h1, h2) = hash_parts(fen, uci);
        for row in 0..DEPTH {
            let cell = &self.cells[slot(h1, h2, row)];
            loop {
                let cur = cell.load(Ordering::Relaxed);
                if cur == u16::MAX {
                    break;
                }
                if cell
                    .compare_exchange_weak(cur, cur + 1, Ordering::Relaxed, Ordering::Relaxed)
                    .is_ok()
                {
                    break;
                }
            }
        }
    }

    fn estimate(&self, fen: &str, uci: Option<&str>) -> u16 {
        let (h1, h2) = hash_parts(fen, uci);
        let mut min = u16::MAX;
        for row in 0..DEPTH {
            min = min.min(self.cells[slot(h1, h2, row)].load(Ordering::Relaxed));
        }
        min
    }

    fn save(&self, path: &Path) {
        let mut file = File::create(path).expect("create sketch");
        let bytes =
            unsafe { std::slice::from_raw_parts(self.cells.as_ptr() as *const u8, SKETCH_BYTES) };
        file.write_all(bytes).expect("write sketch");
    }

    fn load(path: &Path) -> Self {
        let mut file = File::open(path).unwrap_or_else(|_| panic!("missing {}", path.display()));
        let mut cells = Vec::with_capacity(WIDTH * DEPTH);
        unsafe {
            cells.set_len(WIDTH * DEPTH);
            file.read_exact(std::slice::from_raw_parts_mut(
                cells.as_mut_ptr() as *mut u8,
                SKETCH_BYTES,
            ))
            .expect("read sketch");
        }
        Self { cells }
    }
}

fn hash_parts(fen: &str, uci: Option<&str>) -> (u64, u64) {
    let mut h1 = 0x811c9dc5u64;
    let mut h2 = 0x9e3779b9u64;
    for part in [Some(fen), uci] {
        let Some(part) = part else { continue };
        h1 ^= 0xff;
        h2 ^= 0xff;
        for byte in part.as_bytes() {
            h1 = h1.wrapping_mul(0x100000001b3) ^ (*byte as u64);
            h2 = h2.wrapping_mul(0xc2b2ae3d27d4eb4f) ^ (*byte as u64);
        }
    }
    (h1, h2 | 1)
}

fn slot(h1: u64, h2: u64, row: usize) -> usize {
    let mixed = h1.wrapping_add((row as u64).wrapping_mul(h2));
    (mixed as usize & (WIDTH - 1)) + row * WIDTH
}

fn bump_pos(map: &mut FxHashMap<String, [u32; 3]>, key: &str, outcome: usize) {
    if let Some(cell) = map.get_mut(key) {
        cell[outcome] += 1;
        return;
    }
    let mut cell = [0, 0, 0];
    cell[outcome] = 1;
    map.insert(key.to_owned(), cell);
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

fn speed_of(time_control: &str) -> Option<&'static str> {
    let (base, inc) = time_control.split_once('+')?;
    let base: i32 = base.parse().ok()?;
    let inc: i32 = inc.parse().ok()?;
    let total = base + 40 * inc;
    if (180..=479).contains(&total) {
        Some("blitz")
    } else if (480..=1499).contains(&total) {
        Some("rapid")
    } else if (1500..=21599).contains(&total) {
        Some("classical")
    } else {
        None
    }
}

fn band_of(avg: i32) -> &'static str {
    const BANDS: [&str; 9] = [
        "0", "1000", "1200", "1400", "1600", "1800", "2000", "2200", "2500",
    ];
    const FLOORS: [i32; 9] = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
    let mut band = BANDS[0];
    for (floor, name) in FLOORS.iter().zip(BANDS) {
        if avg >= *floor {
            band = name;
        }
    }
    band
}

struct Kept<'a> {
    speed: &'static str,
    band: &'static str,
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
    let speed = speed_of(time_control)?;
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
        speed,
        band: band_of((white + black) / 2),
        outcome,
        body: &game[split + 2..],
    })
}

fn clean_body(body: &str, out: &mut String) {
    out.clear();
    let mut chars = body.chars();
    while let Some(ch) = chars.next() {
        if ch == '{' {
            for next in chars.by_ref() {
                if next == '}' {
                    break;
                }
            }
            out.push(' ');
        } else if ch == ';' {
            for next in chars.by_ref() {
                if next == '\n' {
                    break;
                }
            }
        } else {
            out.push(ch);
        }
    }
}

fn strip_suffix(token: &str) -> &str {
    token.trim_end_matches(['!', '?'])
}

fn is_skippable(token: &str) -> bool {
    if token.is_empty() || token == "1-0" || token == "0-1" || token == "1/2-1/2" || token == "*" {
        return true;
    }
    let bare = token.trim_end_matches('.');
    !bare.is_empty() && bare.bytes().all(|byte| byte.is_ascii_digit())
}

fn push_castles(pos: &Chess, out: &mut String) {
    let castles = pos.castles();
    let start = out.len();
    if castles.has(Color::White, CastlingSide::KingSide) {
        out.push('K');
    }
    if castles.has(Color::White, CastlingSide::QueenSide) {
        out.push('Q');
    }
    if castles.has(Color::Black, CastlingSide::KingSide) {
        out.push('k');
    }
    if castles.has(Color::Black, CastlingSide::QueenSide) {
        out.push('q');
    }
    if out.len() == start {
        out.push('-');
    }
}

fn append_epd(pos: &Chess, out: &mut String) {
    let side = if pos.turn().is_white() { 'w' } else { 'b' };
    use std::fmt::Write as _;
    let _ = write!(out, "{} {side} ", pos.board());
    push_castles(pos, out);
    out.push(' ');
    match pos.ep_square(EnPassantMode::Legal) {
        Some(square) => {
            let _ = write!(out, "{square}");
        }
        None => out.push('-'),
    }
}

fn fill_key(key: &mut String, speed: &str, band: &str, pos: &Chess) -> usize {
    key.clear();
    key.push_str(speed);
    key.push('|');
    key.push_str(band);
    key.push('|');
    let fen_at = key.len();
    append_epd(pos, key);
    fen_at
}

fn walk_game(
    kept: &Kept<'_>,
    cleaned: &mut String,
    key: &mut String,
    uci_buf: &mut String,
    mode: Mode<'_>,
) {
    clean_body(kept.body, cleaned);
    let mut pos = Chess::default();
    let mut played = 0usize;
    for token in cleaned.split_whitespace() {
        if is_skippable(token) {
            continue;
        }
        if played == PLY_CAP {
            break;
        }
        let written = strip_suffix(token);
        let parsed = San::from_ascii(written.as_bytes())
            .ok()
            .and_then(|san| san.to_move(&pos).ok());
        let fen_at = fill_key(key, kept.speed, kept.band, &pos);
        if parsed.is_none() {
            note_position(mode, key, fen_at);
            return;
        }
        let mv = parsed.unwrap();
        note_position(mode, key, fen_at);
        uci_buf.clear();
        use std::fmt::Write as _;
        let _ = write!(
            uci_buf,
            "{}",
            UciMove::from_move(mv.clone(), CastlingMode::Standard)
        );
        let uci_len = uci_buf.len();
        key.push('|');
        key.push_str(uci_buf);
        note_move(mode, key, fen_at, uci_len);
        pos.play_unchecked(mv);
        played += 1;
    }
    if played == 0 {
        return;
    }
    let fen_at = fill_key(key, kept.speed, kept.band, &pos);
    note_position(mode, key, fen_at);
}

#[derive(Clone, Copy)]
struct Mode<'a> {
    pos: &'a Sketch,
    mov: &'a Sketch,
}

fn note_position(mode: Mode<'_>, key: &str, fen_at: usize) {
    mode.pos.add(&key[fen_at..], None);
}

fn note_move(mode: Mode<'_>, key: &str, fen_at: usize, uci_len: usize) {
    let fen_end = key.len() - uci_len - 1;
    let fen = &key[fen_at..fen_end];
    let uci = &key[fen_end + 1..];
    mode.mov.add(fen, Some(uci));
}

fn find_game_end(buf: &[u8]) -> Option<usize> {
    buf.windows(3).position(|window| window == b"\n\n[")
}

fn stream_games(file: &Path, limit: u64, tx: Sender<String>) -> u64 {
    // A plain .pgn is the slice fixture. .pgn.zst is still the full month.
    if file.to_string_lossy().ends_with(".pgn") {
        let reader = File::open(file).expect("open pgn");
        return pump_games(reader, limit, tx, None);
    }
    let zstd = if Path::new("/opt/homebrew/bin/zstd").exists() {
        "/opt/homebrew/bin/zstd"
    } else {
        "zstd"
    };
    let mut child = Command::new(zstd)
        .args(["-dc", "-T0", &file.to_string_lossy()])
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn zstd");
    let stdout = child.stdout.take().expect("zstd stdout");
    let games = pump_games(stdout, limit, tx, Some(&mut child));
    let _ = child.wait();
    games
}

fn pump_games(
    mut reader: impl Read,
    limit: u64,
    tx: Sender<String>,
    mut child: Option<&mut Child>,
) -> u64 {
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
        while let Some(end) = find_game_end(&buf) {
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
                    return games;
                }
            }
        }
        if limit > 0 && games >= limit {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
            }
            break;
        }
    }
    if (limit == 0 || games < limit) && buf.starts_with(b"[") {
        games += 1;
        let _ = tx.send(String::from_utf8_lossy(&buf).into_owned());
    }
    games
}

fn worker_loop(
    rx: crossbeam_channel::Receiver<String>,
    pos: Arc<Sketch>,
    mov: Arc<Sketch>,
    seen: &AtomicU64,
    started: Instant,
) {
    let mut cleaned = String::new();
    let mut key = String::new();
    let mut uci_buf = String::new();
    while let Ok(game) = rx.recv() {
        if let Some(kept) = consider(&game) {
            walk_game(
                &kept,
                &mut cleaned,
                &mut key,
                &mut uci_buf,
                Mode {
                    pos: &pos,
                    mov: &mov,
                },
            );
        }
        let n = seen.fetch_add(1, Ordering::Relaxed) + 1;
        if n % 100_000 == 0 {
            let seconds = started.elapsed().as_secs().max(1);
            println!(
                "{{\"pass\":1,\"seen\":{n},\"seconds\":{seconds},\"perSec\":{}}}",
                n / seconds
            );
        }
    }
}

fn run_pass(file: &Path, limit: u64, data: &Path, workers: usize) {
    println!(
        "{{\"pass\":1,\"allocating\":true,\"sketchBytes\":{}}}",
        SKETCH_BYTES * 2
    );
    let started = Instant::now();
    let pos = Arc::new(Sketch::new());
    let mov = Arc::new(Sketch::new());
    println!(
        "{{\"pass\":1,\"allocated\":true,\"seconds\":{}}}",
        started.elapsed().as_secs()
    );
    let (tx, rx) = bounded::<String>(workers * 8);
    let seen = Arc::new(AtomicU64::new(0));
    let mut handles = Vec::new();
    for _ in 0..workers {
        let rx = rx.clone();
        let seen = Arc::clone(&seen);
        let pos = Arc::clone(&pos);
        let mov = Arc::clone(&mov);
        handles.push(std::thread::spawn(move || {
            worker_loop(rx, pos, mov, &seen, started)
        }));
    }
    drop(rx);
    let queued = stream_games(file, limit, tx);
    for handle in handles {
        handle.join().expect("worker");
    }
    pos.save(&data.join("explorer-sketch-position.bin"));
    mov.save(&data.join("explorer-sketch-move.bin"));
    let seconds = started.elapsed().as_secs();
    println!("{{\"pass\":1,\"counted\":true,\"queued\":{queued},\"seconds\":{seconds}}}");
}

fn hash_text(first: &[u8], second: Option<&[u8]>) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in first {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    if let Some(second) = second {
        hash ^= 0xff;
        for byte in second {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    hash
}

fn cell_at(speed: u8, band: u8, outcome: u8) -> usize {
    speed as usize * 27 + band as usize * 3 + outcome as usize
}

fn speed_slot(speed: &str) -> u8 {
    SPEEDS.iter().position(|name| *name == speed).unwrap_or(0) as u8
}

fn band_slot(band: &str) -> u8 {
    BANDS.iter().position(|name| *name == band).unwrap_or(0) as u8
}

fn shard_of(hash: u64, shards: usize) -> usize {
    ((hash >> 32) as usize) % shards
}

struct PosRow {
    hash: u64,
    fen: String,
    grid: [u32; 81],
}

struct MovRow {
    hash: u64,
    fen: String,
    uci: String,
    san: String,
    grid: [u32; 81],
}

struct PosMap {
    slots: Vec<u32>,
    rows: Vec<PosRow>,
}

struct MovMap {
    slots: Vec<u32>,
    rows: Vec<MovRow>,
}

fn slot_cap(rows: usize) -> usize {
    ((rows.max(1) * 10) / 7).next_power_of_two().max(16)
}

impl PosMap {
    fn new() -> Self {
        Self {
            slots: vec![0; 1024],
            rows: Vec::new(),
        }
    }

    fn with_capacity(rows: usize) -> Self {
        Self {
            slots: vec![0; slot_cap(rows)],
            rows: Vec::with_capacity(rows),
        }
    }

    fn bump(&mut self, hash: u64, fen: Option<&str>, cell: usize) {
        if (self.rows.len() + 1) * 10 > self.slots.len() * 7 {
            self.rehash();
        }
        let mask = self.slots.len() - 1;
        let mut i = (hash as usize) & mask;
        loop {
            let slot = self.slots[i];
            if slot == 0 {
                let text = fen.expect("fen on first sight of a board").to_owned();
                self.rows.push(PosRow {
                    hash,
                    fen: text,
                    grid: [0; 81],
                });
                let idx = self.rows.len() as u32;
                self.slots[i] = idx;
                self.rows[idx as usize - 1].grid[cell] = 1;
                return;
            }
            let row_i = slot as usize - 1;
            if self.rows[row_i].hash == hash {
                let same = match fen {
                    None => true,
                    Some(text) => self.rows[row_i].fen == text,
                };
                if same {
                    self.rows[row_i].grid[cell] += 1;
                    return;
                }
            }
            i = (i + 1) & mask;
        }
    }

    fn rehash(&mut self) {
        let cap = (self.slots.len() * 2).max(16);
        let mut slots = vec![0u32; cap];
        let mask = cap - 1;
        for (idx, row) in self.rows.iter().enumerate() {
            let mut i = (row.hash as usize) & mask;
            while slots[i] != 0 {
                i = (i + 1) & mask;
            }
            slots[i] = (idx as u32) + 1;
        }
        self.slots = slots;
    }
}

impl MovMap {
    fn new() -> Self {
        Self {
            slots: vec![0; 1024],
            rows: Vec::new(),
        }
    }

    fn bump(
        &mut self,
        hash: u64,
        fen: Option<&str>,
        uci: Option<&str>,
        san: Option<&str>,
        cell: usize,
    ) {
        if (self.rows.len() + 1) * 10 > self.slots.len() * 7 {
            self.rehash();
        }
        let mask = self.slots.len() - 1;
        let mut i = (hash as usize) & mask;
        loop {
            let slot = self.slots[i];
            if slot == 0 {
                self.rows.push(MovRow {
                    hash,
                    fen: fen.expect("fen on first sight of a move").to_owned(),
                    uci: uci.expect("uci on first sight of a move").to_owned(),
                    san: san.expect("san on first sight of a move").to_owned(),
                    grid: [0; 81],
                });
                let idx = self.rows.len() as u32;
                self.slots[i] = idx;
                self.rows[idx as usize - 1].grid[cell] = 1;
                return;
            }
            let row_i = slot as usize - 1;
            if self.rows[row_i].hash == hash {
                let same = match (fen, uci) {
                    (None, _) => true,
                    (Some(fen), Some(uci)) => {
                        self.rows[row_i].fen == fen && self.rows[row_i].uci == uci
                    }
                    (Some(fen), None) => self.rows[row_i].fen == fen,
                };
                if same {
                    self.rows[row_i].grid[cell] += 1;
                    return;
                }
            }
            i = (i + 1) & mask;
        }
    }

    fn rehash(&mut self) {
        let cap = (self.slots.len() * 2).max(16);
        let mut slots = vec![0u32; cap];
        let mask = cap - 1;
        for (idx, row) in self.rows.iter().enumerate() {
            let mut i = (row.hash as usize) & mask;
            while slots[i] != 0 {
                i = (i + 1) & mask;
            }
            slots[i] = (idx as u32) + 1;
        }
        self.slots = slots;
    }
}

struct PosUp {
    hash: u64,
    speed: u8,
    band: u8,
    outcome: u8,
    fen: Option<String>,
}

struct MovUp {
    hash: u64,
    speed: u8,
    band: u8,
    outcome: u8,
    fen: Option<String>,
    uci: Option<String>,
    san: Option<String>,
}

enum ShardMsg {
    Pos(Vec<PosUp>),
    Mov(Vec<MovUp>),
}

struct Shard {
    positions: PosMap,
    moves: MovMap,
}

fn push_pos(batch: &mut Vec<PosUp>, tx: &Sender<ShardMsg>, up: PosUp) {
    batch.push(up);
    if batch.len() >= BATCH {
        let full = std::mem::replace(batch, Vec::with_capacity(BATCH));
        tx.send(ShardMsg::Pos(full)).expect("position shard closed");
    }
}

fn push_mov(batch: &mut Vec<MovUp>, tx: &Sender<ShardMsg>, up: MovUp) {
    batch.push(up);
    if batch.len() >= BATCH {
        let full = std::mem::replace(batch, Vec::with_capacity(BATCH));
        tx.send(ShardMsg::Mov(full)).expect("move shard closed");
    }
}

fn shard_loop(rx: crossbeam_channel::Receiver<ShardMsg>) -> Shard {
    let mut positions = PosMap::new();
    let mut moves = MovMap::new();
    while let Ok(msg) = rx.recv() {
        match msg {
            ShardMsg::Pos(batch) => {
                for up in batch {
                    positions.bump(
                        up.hash,
                        up.fen.as_deref(),
                        cell_at(up.speed, up.band, up.outcome),
                    );
                }
            }
            ShardMsg::Mov(batch) => {
                for up in batch {
                    moves.bump(
                        up.hash,
                        up.fen.as_deref(),
                        up.uci.as_deref(),
                        up.san.as_deref(),
                        cell_at(up.speed, up.band, up.outcome),
                    );
                }
            }
        }
    }
    Shard { positions, moves }
}

struct Parser {
    threshold: u16,
    seen_pos: FxHashSet<u64>,
    seen_mov: FxHashSet<u64>,
    pos_batches: Vec<Vec<PosUp>>,
    mov_batches: Vec<Vec<MovUp>>,
    cleaned: String,
    fen: String,
    uci_buf: String,
}

impl Parser {
    fn new(shards: usize, threshold: u16) -> Self {
        Self {
            threshold,
            seen_pos: FxHashSet::default(),
            seen_mov: FxHashSet::default(),
            pos_batches: (0..shards).map(|_| Vec::with_capacity(BATCH)).collect(),
            mov_batches: (0..shards).map(|_| Vec::with_capacity(BATCH)).collect(),
            cleaned: String::new(),
            fen: String::new(),
            uci_buf: String::new(),
        }
    }

    fn note_pos(&mut self, txs: &[Sender<ShardMsg>], kept: &Kept<'_>, pos_sketch: &Sketch) {
        if pos_sketch.estimate(&self.fen, None) < self.threshold {
            return;
        }
        let hash = hash_text(self.fen.as_bytes(), None);
        let shard = shard_of(hash, txs.len());
        let first = self.seen_pos.insert(hash);
        push_pos(
            &mut self.pos_batches[shard],
            &txs[shard],
            PosUp {
                hash,
                speed: speed_slot(kept.speed),
                band: band_slot(kept.band),
                outcome: kept.outcome as u8,
                fen: if first { Some(self.fen.clone()) } else { None },
            },
        );
    }

    fn note_mov(
        &mut self,
        txs: &[Sender<ShardMsg>],
        kept: &Kept<'_>,
        mov_sketch: &Sketch,
        san: &str,
    ) {
        if mov_sketch.estimate(&self.fen, Some(&self.uci_buf)) < self.threshold {
            return;
        }
        let hash = hash_text(self.fen.as_bytes(), Some(self.uci_buf.as_bytes()));
        let shard = shard_of(hash, txs.len());
        let first = self.seen_mov.insert(hash);
        push_mov(
            &mut self.mov_batches[shard],
            &txs[shard],
            MovUp {
                hash,
                speed: speed_slot(kept.speed),
                band: band_slot(kept.band),
                outcome: kept.outcome as u8,
                fen: if first { Some(self.fen.clone()) } else { None },
                uci: if first {
                    Some(self.uci_buf.clone())
                } else {
                    None
                },
                san: if first { Some(san.to_owned()) } else { None },
            },
        );
    }

    fn walk(
        &mut self,
        kept: &Kept<'_>,
        txs: &[Sender<ShardMsg>],
        pos_sketch: &Sketch,
        mov_sketch: &Sketch,
    ) {
        clean_body(kept.body, &mut self.cleaned);
        let cleaned = std::mem::take(&mut self.cleaned);
        let mut pos = Chess::default();
        let mut played = 0usize;
        for token in cleaned.split_whitespace() {
            if is_skippable(token) {
                continue;
            }
            if played == PLY_CAP {
                break;
            }
            let written = strip_suffix(token);
            let parsed = San::from_ascii(written.as_bytes())
                .ok()
                .and_then(|san| san.to_move(&pos).ok());
            self.fen.clear();
            append_epd(&pos, &mut self.fen);
            let Some(mv) = parsed else {
                self.note_pos(txs, kept, pos_sketch);
                self.cleaned = cleaned;
                return;
            };
            self.note_pos(txs, kept, pos_sketch);
            self.uci_buf.clear();
            use std::fmt::Write as _;
            let _ = write!(
                self.uci_buf,
                "{}",
                UciMove::from_move(mv.clone(), CastlingMode::Standard)
            );
            self.note_mov(txs, kept, mov_sketch, written);
            pos.play_unchecked(mv);
            played += 1;
        }
        self.cleaned = cleaned;
        if played == 0 {
            return;
        }
        self.fen.clear();
        append_epd(&pos, &mut self.fen);
        self.note_pos(txs, kept, pos_sketch);
    }

    fn finish(&mut self, txs: &[Sender<ShardMsg>]) {
        for (shard, batch) in self.pos_batches.iter_mut().enumerate() {
            if !batch.is_empty() {
                let full = std::mem::take(batch);
                txs[shard]
                    .send(ShardMsg::Pos(full))
                    .expect("position shard closed");
            }
        }
        for (shard, batch) in self.mov_batches.iter_mut().enumerate() {
            if !batch.is_empty() {
                let full = std::mem::take(batch);
                txs[shard]
                    .send(ShardMsg::Mov(full))
                    .expect("move shard closed");
            }
        }
    }
}

fn parser_loop(
    rx: crossbeam_channel::Receiver<String>,
    txs: Vec<Sender<ShardMsg>>,
    pos_sketch: Arc<Sketch>,
    mov_sketch: Arc<Sketch>,
    threshold: u16,
    seen: Arc<AtomicU64>,
    started: Instant,
) {
    let mut parser = Parser::new(txs.len(), threshold);
    while let Ok(game) = rx.recv() {
        if let Some(kept) = consider(&game) {
            parser.walk(&kept, &txs, &pos_sketch, &mov_sketch);
        }
        let n = seen.fetch_add(1, Ordering::Relaxed) + 1;
        if n % 100_000 == 0 {
            let seconds = started.elapsed().as_secs().max(1);
            println!(
                "{{\"pass\":2,\"seen\":{n},\"seconds\":{seconds},\"perSec\":{}}}",
                n / seconds
            );
        }
    }
    parser.finish(&txs);
}

fn run_fast_pass(file: &Path, limit: u64, threshold: u64, data: &Path, workers: usize) {
    println!("{{\"pass\":2,\"loading\":true}}");
    let pos = Arc::new(Sketch::load(&data.join("explorer-sketch-position.bin")));
    let mov = Arc::new(Sketch::load(&data.join("explorer-sketch-move.bin")));
    let (game_tx, game_rx) = bounded::<String>(workers * 8);
    let mut txs = Vec::new();
    let mut handles = Vec::new();
    for _ in 0..workers {
        let (tx, rx) = bounded::<ShardMsg>(4);
        txs.push(tx);
        handles.push(std::thread::spawn(move || shard_loop(rx)));
    }
    let seen = Arc::new(AtomicU64::new(0));
    let started = Instant::now();
    let mut parsers = Vec::new();
    for _ in 0..workers {
        let rx = game_rx.clone();
        let txs = txs.clone();
        let pos = Arc::clone(&pos);
        let mov = Arc::clone(&mov);
        let seen = Arc::clone(&seen);
        parsers.push(std::thread::spawn(move || {
            parser_loop(rx, txs, pos, mov, threshold as u16, seen, started)
        }));
    }
    drop(game_rx);
    let queued = stream_games(file, limit, game_tx);
    for handle in parsers {
        handle.join().expect("parser");
    }
    drop(txs);
    let shards: Vec<Shard> = handles
        .into_iter()
        .map(|handle| handle.join().expect("shard"))
        .collect();
    let seconds = started.elapsed().as_secs();
    println!("{{\"pass\":2,\"counted\":true,\"queued\":{queued},\"seconds\":{seconds}}}");
    write_compact(data, &shards, threshold);
}

fn write_compact(data: &Path, shards: &[Shard], threshold: u64) {
    let path = data.join("explorer-2026-09.sqlite");
    if path.exists() {
        fs::remove_file(&path).ok();
    }
    let mut db = Connection::open(&path).expect("open scratch");
    db.pragma_update(None, "journal_mode", "OFF").ok();
    db.pragma_update(None, "synchronous", "OFF").ok();
    db.execute_batch(
        "CREATE TABLE explorer_position (
            speed TEXT NOT NULL,
            rating_band TEXT NOT NULL,
            position TEXT NOT NULL,
            white INTEGER NOT NULL,
            draws INTEGER NOT NULL,
            black INTEGER NOT NULL
        );
        CREATE TABLE explorer_move (
            speed TEXT NOT NULL,
            rating_band TEXT NOT NULL,
            position TEXT NOT NULL,
            uci TEXT NOT NULL,
            san TEXT NOT NULL,
            white INTEGER NOT NULL,
            draws INTEGER NOT NULL,
            black INTEGER NOT NULL
        );",
    )
    .expect("create tables");
    let tx = db.transaction().expect("tx");
    {
        let mut insert = tx
            .prepare(
                "INSERT INTO explorer_position (speed, rating_band, position, white, draws, black)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .expect("prepare pos");
        for shard in shards {
            for row in &shard.positions.rows {
                let total: u64 = row.grid.iter().map(|cell| *cell as u64).sum();
                if total < threshold {
                    continue;
                }
                for speed in 0..3 {
                    for band in 0..9 {
                        let base = (speed * 9 + band) * 3;
                        let white = row.grid[base];
                        let draws = row.grid[base + 1];
                        let black = row.grid[base + 2];
                        if white == 0 && draws == 0 && black == 0 {
                            continue;
                        }
                        insert
                            .execute((
                                SPEEDS[speed],
                                BANDS[band],
                                row.fen.as_str(),
                                white,
                                draws,
                                black,
                            ))
                            .expect("insert pos");
                    }
                }
            }
        }
    }
    {
        let mut insert = tx
            .prepare(
                "INSERT INTO explorer_move (speed, rating_band, position, uci, san, white, draws, black)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .expect("prepare move");
        for shard in shards {
            for row in &shard.moves.rows {
                let total: u64 = row.grid.iter().map(|cell| *cell as u64).sum();
                if total < threshold {
                    continue;
                }
                for speed in 0..3 {
                    for band in 0..9 {
                        let base = (speed * 9 + band) * 3;
                        let white = row.grid[base];
                        let draws = row.grid[base + 1];
                        let black = row.grid[base + 2];
                        if white == 0 && draws == 0 && black == 0 {
                            continue;
                        }
                        insert
                            .execute((
                                SPEEDS[speed],
                                BANDS[band],
                                row.fen.as_str(),
                                row.uci.as_str(),
                                row.san.as_str(),
                                white,
                                draws,
                                black,
                            ))
                            .expect("insert move");
                    }
                }
            }
        }
    }
    tx.commit().expect("commit");
    let pos_n: i64 = db
        .query_row("SELECT COUNT(*) FROM explorer_position", [], |row| {
            row.get(0)
        })
        .unwrap();
    let move_n: i64 = db
        .query_row("SELECT COUNT(*) FROM explorer_move", [], |row| row.get(0))
        .unwrap();
    println!(
        "{{\"scratch\":\"{}\",\"positions\":{pos_n},\"moves\":{move_n}}}",
        path.display()
    );
}

struct XorShift(u64);

impl XorShift {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
}

fn synth_board(i: u32) -> String {
    let mut text = format!("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - {i:08}");
    while text.len() < 70 {
        text.push('#');
    }
    text
}

fn mem_kb(field: &str) -> u64 {
    let status = fs::read_to_string("/proc/self/status").unwrap_or_default();
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix(field) {
            return rest
                .split_whitespace()
                .next()
                .unwrap_or("0")
                .parse()
                .unwrap_or(0);
        }
    }
    0
}

#[inline(never)]
fn bench_compact_updates(
    map: &mut PosMap,
    boards: &[String],
    board_hash: &[u64],
    extra: &[String],
    extra_hash: &[u64],
) -> u64 {
    let mut rng = XorShift(0x9E3779B97F4A7C15);
    for _ in 0..40_000_000 {
        let roll = rng.next();
        let hit = roll % 10 != 0;
        let speed = ((roll >> 40) % 3) as u8;
        let band = ((roll >> 44) % 9) as u8;
        let outcome = ((roll >> 48) % 3) as u8;
        let cell = cell_at(speed, band, outcome);
        if hit {
            let idx = ((roll >> 4) as usize) % boards.len();
            map.bump(board_hash[idx], None, cell);
        } else {
            let idx = ((roll >> 4) as usize) % extra.len();
            map.bump(extra_hash[idx], Some(&extra[idx]), cell);
        }
    }
    map.rows.iter().map(|row| row.grid[0] as u64).sum()
}

#[inline(never)]
fn bench_string_updates(
    map: &mut FxHashMap<String, [u32; 3]>,
    boards: &[String],
    extra: &[String],
) -> u64 {
    let mut rng = XorShift(0x9E3779B97F4A7C15);
    let mut key = String::with_capacity(96);
    for _ in 0..40_000_000 {
        let roll = rng.next();
        let hit = roll % 10 != 0;
        let speed = SPEEDS[((roll >> 40) % 3) as usize];
        let band = BANDS[((roll >> 44) % 9) as usize];
        let outcome = ((roll >> 48) % 3) as usize;
        let fen = if hit {
            &boards[((roll >> 4) as usize) % boards.len()]
        } else {
            &extra[((roll >> 4) as usize) % extra.len()]
        };
        key.clear();
        key.push_str(speed);
        key.push('|');
        key.push_str(band);
        key.push('|');
        key.push_str(fen);
        bump_pos(map, &key, outcome);
    }
    map.values().map(|cell| cell[0] as u64).sum()
}

fn run_bench() {
    const BOARDS: u32 = 2_000_000;
    const EXTRA: u32 = 200_000;
    let boards: Vec<String> = (0..BOARDS).map(synth_board).collect();
    let extra: Vec<String> = (BOARDS..BOARDS + EXTRA).map(synth_board).collect();
    let board_hash: Vec<u64> = boards
        .iter()
        .map(|fen| hash_text(fen.as_bytes(), None))
        .collect();
    let extra_hash: Vec<u64> = extra
        .iter()
        .map(|fen| hash_text(fen.as_bytes(), None))
        .collect();
    println!(
        "{{\"bench\":true,\"boards\":{},\"extra\":{},\"updates\":40000000,\"fenBytes\":{}}}",
        boards.len(),
        extra.len(),
        boards[0].len()
    );

    let mut compact = PosMap::with_capacity(boards.len() + extra.len());
    for (fen, hash) in boards.iter().zip(&board_hash) {
        compact.bump(*hash, Some(fen), 0);
    }
    let started = Instant::now();
    let checksum = bench_compact_updates(&mut compact, &boards, &board_hash, &extra, &extra_hash);
    let compact_secs = started.elapsed().as_secs_f64();
    let compact_rate = 40_000_000.0 / compact_secs;
    let compact_rss = mem_kb("VmRSS:") * 1024;
    let compact_hwm = mem_kb("VmHWM:") * 1024;
    println!(
        "{{\"map\":\"compact\",\"boards\":{},\"updates\":40000000,\"seconds\":{compact_secs:.3},\"perSec\":{compact_rate:.0},\"rssBytes\":{compact_rss},\"hwmBytes\":{compact_hwm},\"rows\":{},\"checksum\":{checksum}}}",
        boards.len(),
        compact.rows.len()
    );
    let _ = std::io::stdout().flush();
    drop(compact);

    let mut string_map: FxHashMap<String, [u32; 3]> = FxHashMap::default();
    for fen in &boards {
        let key = format!("blitz|0|{fen}");
        bump_pos(&mut string_map, &key, 0);
    }
    let started = Instant::now();
    let checksum = bench_string_updates(&mut string_map, &boards, &extra);
    let string_secs = started.elapsed().as_secs_f64();
    let string_rate = 40_000_000.0 / string_secs;
    let string_rss = mem_kb("VmRSS:") * 1024;
    let string_hwm = mem_kb("VmHWM:") * 1024;
    println!(
        "{{\"map\":\"string\",\"boards\":{},\"updates\":40000000,\"seconds\":{string_secs:.3},\"perSec\":{string_rate:.0},\"rssBytes\":{string_rss},\"hwmBytes\":{string_hwm},\"rows\":{},\"checksum\":{checksum}}}",
        boards.len(),
        string_map.len()
    );
}

fn arg(name: &str) -> Option<String> {
    let flag = format!("--{name}");
    let mut args = std::env::args().skip(1);
    while let Some(item) = args.next() {
        if item == flag {
            return args.next();
        }
    }
    None
}

fn dump_line(moves: &[&str]) {
    let mut pos = Chess::default();
    let mut key = String::new();
    append_epd(&pos, &mut key);
    println!("start {key}");
    for san in moves {
        let mv = San::from_ascii(san.as_bytes())
            .unwrap()
            .to_move(&pos)
            .unwrap();
        pos.play_unchecked(mv);
        key.clear();
        append_epd(&pos, &mut key);
        println!("{san} {key}");
    }
}

fn main() {
    let pass = arg("pass").unwrap_or_else(|| "all".to_owned());
    if pass == "fen" {
        dump_line(&["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4"]);
        dump_line(&["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O"]);
        return;
    }
    if pass == "bench" {
        run_bench();
        return;
    }
    let file = arg("file").map(PathBuf::from).unwrap_or_else(|| {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_owned());
        PathBuf::from(home).join("Downloads/lichess_db_standard_rated_2026-09.pgn.zst")
    });
    let limit = arg("limit")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let threshold = arg("threshold")
        .and_then(|value| value.parse().ok())
        .unwrap_or(100u64);
    let data = arg("data")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".data"));
    fs::create_dir_all(&data).ok();
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(8);
    println!(
        "{{\"file\":\"{}\",\"pass\":\"{pass}\",\"limit\":{limit},\"threshold\":{threshold},\"workers\":{workers}}}",
        file.display()
    );

    if pass == "1" || pass == "all" {
        run_pass(&file, limit, &data, workers);
    }
    if pass == "2" || pass == "all" {
        run_fast_pass(&file, limit, threshold, &data, workers);
    }
}
