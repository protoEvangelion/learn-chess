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
use shakmaty::{CastlingSide, Chess, Color, EnPassantMode, Position};

const WIDTH: usize = 1 << 27;
const DEPTH: usize = 1;
const PLY_CAP: usize = 50;
const SKETCH_BYTES: usize = WIDTH * DEPTH * 2;
const BATCH: usize = 4096;
const SPEEDS: [&str; 3] = ["blitz", "rapid", "classical"];
const BANDS: [&str; 9] = [
    "0", "1000", "1200", "1400", "1600", "1800", "2000", "2200", "2500",
];

struct Sketch {
    cells: *mut AtomicU16,
}

unsafe impl Send for Sketch {}
unsafe impl Sync for Sketch {}

impl Drop for Sketch {
    fn drop(&mut self) {
        unsafe extern "C" {
            fn munmap(addr: *mut std::ffi::c_void, len: usize) -> i32;
        }
        unsafe {
            munmap(self.cells as *mut std::ffi::c_void, SKETCH_BYTES);
        }
    }
}

impl Sketch {
    fn new() -> Self {
        unsafe extern "C" {
            fn mmap(
                addr: *mut std::ffi::c_void,
                len: usize,
                prot: i32,
                flags: i32,
                fd: i32,
                offset: i64,
            ) -> *mut std::ffi::c_void;
        }
        const PROT_READ: i32 = 1;
        const PROT_WRITE: i32 = 2;
        const MAP_PRIVATE: i32 = 2;
        const MAP_ANONYMOUS: i32 = 0x20;
        let ptr = unsafe {
            mmap(
                std::ptr::null_mut(),
                SKETCH_BYTES,
                PROT_READ | PROT_WRITE,
                MAP_PRIVATE | MAP_ANONYMOUS,
                -1,
                0,
            )
        };
        if ptr.is_null() || ptr as isize == -1 {
            panic!("mmap sketch");
        }
        unsafe extern "C" {
            fn madvise(addr: *mut std::ffi::c_void, len: usize, advice: i32) -> i32;
        }
        const MADV_HUGEPAGE: i32 = 14;
        unsafe {
            madvise(ptr, SKETCH_BYTES, MADV_HUGEPAGE);
        }
        Self {
            cells: ptr as *mut AtomicU16,
        }
    }

    fn cell(&self, index: usize) -> &AtomicU16 {
        unsafe { &*self.cells.add(index) }
    }

    fn add_hashes(&self, h1: u64, h2: u64) {
        for row in 0..DEPTH {
            let cell = self.cell(slot(h1, h2, row));
            let old = cell.fetch_add(1, Ordering::Relaxed);
            if old >= u16::MAX - 1 {
                cell.store(u16::MAX, Ordering::Relaxed);
            }
        }
    }

    fn estimate_hashes(&self, h1: u64, h2: u64) -> u16 {
        let mut min = u16::MAX;
        for row in 0..DEPTH {
            let index = slot(h1, h2, row);
            unsafe {
                std::arch::x86_64::_mm_prefetch(
                    self.cells.add(index) as *const i8,
                    std::arch::x86_64::_MM_HINT_T0,
                );
            }
            min = min.min(self.cell(index).load(Ordering::Relaxed));
        }
        min
    }

    fn save(&self, path: &Path) {
        let mut file = File::create(path).expect("create sketch");
        let bytes = unsafe { std::slice::from_raw_parts(self.cells as *const u8, SKETCH_BYTES) };
        file.write_all(bytes).expect("write sketch");
    }

    fn load(path: &Path) -> Self {
        let mut file = File::open(path).unwrap_or_else(|_| panic!("missing {}", path.display()));
        let sketch = Self::new();
        let bytes =
            unsafe { std::slice::from_raw_parts_mut(sketch.cells as *mut u8, SKETCH_BYTES) };
        file.read_exact(bytes).expect("read sketch");
        sketch
    }
}

fn position_hash(pos: &Chess) -> (u64, u64) {
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
    (h1, h2 | 1)
}

fn move_hash(h1: u64, h2: u64, uci: &str) -> (u64, u64) {
    let mut a = h1 ^ 0x9e3779b97f4a7c15;
    let mut b = h2 ^ 0xbf58476d1ce4e5b9;
    for byte in uci.as_bytes() {
        a = a.wrapping_mul(0x100000001b3) ^ (*byte as u64);
        b = b.wrapping_mul(0xc2b2ae3d27d4eb4f) ^ (*byte as u64);
    }
    (a, b | 1)
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
    pos.board().board_fen().append_to_string(out);
    out.push(' ');
    out.push(if pos.turn().is_white() { 'w' } else { 'b' });
    out.push(' ');
    push_castles(pos, out);
    out.push(' ');
    match pos.ep_square(EnPassantMode::Legal) {
        Some(square) => {
            use std::fmt::Write as _;
            let _ = write!(out, "{square}");
        }
        None => out.push('-'),
    }
}

fn write_uci(mv: &shakmaty::Move, out: &mut String) {
    out.clear();
    use std::fmt::Write as _;
    let _ = write!(out, "{}", UciMove::from_standard(*mv));
}

fn walk_sketch(
    kept: &Kept<'_>,
    cleaned: &mut String,
    uci_buf: &mut String,
    pos_sketch: &Sketch,
    mov_sketch: &Sketch,
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
        let (h1, h2) = position_hash(&pos);
        let Some(mv) = parsed else {
            pos_sketch.add_hashes(h1, h2);
            return;
        };
        pos_sketch.add_hashes(h1, h2);
        write_uci(&mv, uci_buf);
        let (m1, m2) = move_hash(h1, h2, uci_buf);
        mov_sketch.add_hashes(m1, m2);
        pos.play_unchecked(mv);
        played += 1;
    }
    if played == 0 {
        return;
    }
    let (h1, h2) = position_hash(&pos);
    pos_sketch.add_hashes(h1, h2);
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
    let mut uci_buf = String::new();
    while let Ok(game) = rx.recv() {
        if let Some(kept) = consider(&game) {
            walk_sketch(&kept, &mut cleaned, &mut uci_buf, &pos, &mov);
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
    let counted = started.elapsed().as_secs_f64();
    pos.save(&data.join("explorer-sketch-position.bin"));
    mov.save(&data.join("explorer-sketch-move.bin"));
    let seconds = started.elapsed().as_secs_f64();
    println!(
        "{{\"pass\":1,\"counted\":true,\"queued\":{queued},\"walkSec\":{counted:.3},\"seconds\":{seconds:.3}}}"
    );
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

    fn bump_owned(&mut self, hash: u64, fen: Option<String>, cell: usize) {
        if (self.rows.len() + 1) * 10 > self.slots.len() * 7 {
            self.rehash();
        }
        let mask = self.slots.len() - 1;
        let mut i = (hash as usize) & mask;
        loop {
            let slot = self.slots[i];
            if slot == 0 {
                self.rows.push(PosRow {
                    hash,
                    fen: fen.expect("fen on first sight of a board"),
                    grid: [0; 81],
                });
                let idx = self.rows.len() as u32;
                self.slots[i] = idx;
                self.rows[idx as usize - 1].grid[cell] = 1;
                return;
            }
            let row_i = slot as usize - 1;
            if self.rows[row_i].hash == hash {
                let same = match fen.as_deref() {
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
    fn with_capacity(rows: usize) -> Self {
        Self {
            slots: vec![0; slot_cap(rows)],
            rows: Vec::with_capacity(rows),
        }
    }

    fn bump_owned(
        &mut self,
        hash: u64,
        fen: Option<String>,
        uci: Option<String>,
        san: Option<String>,
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
                    fen: fen.expect("fen on first sight of a move"),
                    uci: uci.expect("uci on first sight of a move"),
                    san: san.expect("san on first sight of a move"),
                    grid: [0; 81],
                });
                let idx = self.rows.len() as u32;
                self.slots[i] = idx;
                self.rows[idx as usize - 1].grid[cell] = 1;
                return;
            }
            let row_i = slot as usize - 1;
            if self.rows[row_i].hash == hash {
                let same = match (fen.as_deref(), uci.as_deref()) {
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
    let mut positions = PosMap::with_capacity(700_000);
    let mut moves = MovMap::with_capacity(700_000);
    while let Ok(msg) = rx.recv() {
        match msg {
            ShardMsg::Pos(batch) => {
                for up in batch {
                    positions.bump_owned(up.hash, up.fen, cell_at(up.speed, up.band, up.outcome));
                }
            }
            ShardMsg::Mov(batch) => {
                for up in batch {
                    moves.bump_owned(
                        up.hash,
                        up.fen,
                        up.uci,
                        up.san,
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

    fn note_pos(
        &mut self,
        txs: &[Sender<ShardMsg>],
        kept: &Kept<'_>,
        pos_sketch: &Sketch,
        board: &Chess,
    ) {
        let (h1, h2) = position_hash(board);
        if pos_sketch.estimate_hashes(h1, h2) < self.threshold {
            return;
        }
        if self.fen.is_empty() {
            append_epd(board, &mut self.fen);
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
        board: &Chess,
        board_hash: (u64, u64),
    ) {
        let (h1, h2) = move_hash(board_hash.0, board_hash.1, &self.uci_buf);
        if mov_sketch.estimate_hashes(h1, h2) < self.threshold {
            return;
        }
        if self.fen.is_empty() {
            append_epd(board, &mut self.fen);
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
            let Some(mv) = parsed else {
                self.note_pos(txs, kept, pos_sketch, &pos);
                self.cleaned = cleaned;
                return;
            };
            let board_hash = position_hash(&pos);
            self.note_pos(txs, kept, pos_sketch, &pos);
            write_uci(&mv, &mut self.uci_buf);
            self.note_mov(txs, kept, mov_sketch, written, &pos, board_hash);
            pos.play_unchecked(mv);
            played += 1;
        }
        self.cleaned = cleaned;
        if played == 0 {
            return;
        }
        self.fen.clear();
        self.note_pos(txs, kept, pos_sketch, &pos);
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
    let load_started = Instant::now();
    let pos = Arc::new(Sketch::load(&data.join("explorer-sketch-position.bin")));
    let mov = Arc::new(Sketch::load(&data.join("explorer-sketch-move.bin")));
    println!(
        "{{\"pass\":2,\"loadedSec\":{:.3}}}",
        load_started.elapsed().as_secs_f64()
    );
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
    let seconds = started.elapsed().as_secs_f64();
    println!("{{\"pass\":2,\"counted\":true,\"queued\":{queued},\"seconds\":{seconds:.3}}}");
    let write_started = Instant::now();
    write_compact(data, &shards, threshold);
    println!(
        "{{\"pass\":2,\"wroteSec\":{:.3}}}",
        write_started.elapsed().as_secs_f64()
    );
}

fn write_part(path: &Path, shard: &Shard, threshold: u64) {
    if path.exists() {
        fs::remove_file(path).ok();
    }
    let mut db = Connection::open(path).expect("open part");
    db.pragma_update(None, "page_size", 65536).ok();
    db.pragma_update(None, "journal_mode", "OFF").ok();
    db.pragma_update(None, "synchronous", "OFF").ok();
    db.pragma_update(None, "locking_mode", "EXCLUSIVE").ok();
    db.pragma_update(None, "temp_store", "MEMORY").ok();
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
    .expect("create part");
    let tx = db.transaction().expect("part tx");
    insert_position_rows(&tx, &shard.positions.rows, threshold);
    insert_move_rows(&tx, &shard.moves.rows, threshold);
    tx.commit().expect("commit part");
}

fn insert_sql(table: &str, cols: &str, n_cols: usize, n_rows: usize) -> String {
    let mut sql = format!("INSERT INTO {table} ({cols}) VALUES ");
    for row in 0..n_rows {
        if row > 0 {
            sql.push(',');
        }
        sql.push('(');
        for col in 0..n_cols {
            if col > 0 {
                sql.push(',');
            }
            sql.push('?');
            sql.push_str(&(row * n_cols + col + 1).to_string());
        }
        sql.push(')');
    }
    sql
}

fn insert_position_rows(tx: &rusqlite::Transaction, rows: &[PosRow], threshold: u64) {
    const N: usize = 24;
    let mut batch = tx
        .prepare(&insert_sql(
            "explorer_position",
            "speed, rating_band, position, white, draws, black",
            6,
            N,
        ))
        .expect("prepare pos batch");
    let mut one = tx
        .prepare(
            "INSERT INTO explorer_position (speed, rating_band, position, white, draws, black)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .expect("prepare pos");
    let mut queued: Vec<(&str, &str, &str, u32, u32, u32)> = Vec::with_capacity(N);
    let flush = |queued: &mut Vec<(&str, &str, &str, u32, u32, u32)>,
                 batch: &mut rusqlite::Statement,
                 one: &mut rusqlite::Statement| {
        if queued.is_empty() {
            return;
        }
        if queued.len() == N {
            for (i, item) in queued.iter().enumerate() {
                let base = i * 6;
                batch.raw_bind_parameter(base + 1, item.0).unwrap();
                batch.raw_bind_parameter(base + 2, item.1).unwrap();
                batch.raw_bind_parameter(base + 3, item.2).unwrap();
                batch.raw_bind_parameter(base + 4, item.3).unwrap();
                batch.raw_bind_parameter(base + 5, item.4).unwrap();
                batch.raw_bind_parameter(base + 6, item.5).unwrap();
            }
            batch.raw_execute().expect("insert pos");
        } else {
            for item in queued.iter() {
                one.execute(*item).expect("insert pos");
            }
        }
        queued.clear();
    };
    for row in rows {
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
                queued.push((
                    SPEEDS[speed],
                    BANDS[band],
                    row.fen.as_str(),
                    white,
                    draws,
                    black,
                ));
                if queued.len() == N {
                    flush(&mut queued, &mut batch, &mut one);
                }
            }
        }
    }
    flush(&mut queued, &mut batch, &mut one);
}

fn insert_move_rows(tx: &rusqlite::Transaction, rows: &[MovRow], threshold: u64) {
    const N: usize = 16;
    let mut batch = tx
        .prepare(&insert_sql(
            "explorer_move",
            "speed, rating_band, position, uci, san, white, draws, black",
            8,
            N,
        ))
        .expect("prepare move batch");
    let mut one = tx
        .prepare(
            "INSERT INTO explorer_move (speed, rating_band, position, uci, san, white, draws, black)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .expect("prepare move");
    let mut queued: Vec<(&str, &str, &str, &str, &str, u32, u32, u32)> = Vec::with_capacity(N);
    for row in rows {
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
                queued.push((
                    SPEEDS[speed],
                    BANDS[band],
                    row.fen.as_str(),
                    row.uci.as_str(),
                    row.san.as_str(),
                    white,
                    draws,
                    black,
                ));
                if queued.len() == N {
                    for (i, item) in queued.iter().enumerate() {
                        let b = i * 8;
                        batch.raw_bind_parameter(b + 1, item.0).unwrap();
                        batch.raw_bind_parameter(b + 2, item.1).unwrap();
                        batch.raw_bind_parameter(b + 3, item.2).unwrap();
                        batch.raw_bind_parameter(b + 4, item.3).unwrap();
                        batch.raw_bind_parameter(b + 5, item.4).unwrap();
                        batch.raw_bind_parameter(b + 6, item.5).unwrap();
                        batch.raw_bind_parameter(b + 7, item.6).unwrap();
                        batch.raw_bind_parameter(b + 8, item.7).unwrap();
                    }
                    batch.raw_execute().expect("insert move");
                    queued.clear();
                }
            }
        }
    }
    for item in &queued {
        one.execute(*item).expect("insert move");
    }
}

fn write_compact(data: &Path, shards: &[Shard], threshold: u64) {
    let path = data.join("explorer-2026-09.sqlite");
    if path.exists() {
        fs::remove_file(&path).ok();
    }
    let dir = data.to_path_buf();
    let built = path.clone();
    std::thread::scope(|scope| {
        for (index, shard) in shards.iter().enumerate() {
            let part = dir.join(format!("explorer-part-{index}.sqlite"));
            scope.spawn(move || write_part(&part, shard, threshold));
        }
    });
    let db = Connection::open(&built).expect("open scratch");
    db.pragma_update(None, "page_size", 65536).ok();
    db.pragma_update(None, "journal_mode", "OFF").ok();
    db.pragma_update(None, "synchronous", "OFF").ok();
    db.pragma_update(None, "locking_mode", "EXCLUSIVE").ok();
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
    for index in 0..shards.len() {
        let part = dir.join(format!("explorer-part-{index}.sqlite"));
        db.execute("ATTACH ?1 AS part", [part.to_string_lossy().as_ref()])
            .expect("attach");
        db.execute_batch(
            "INSERT INTO explorer_position SELECT * FROM part.explorer_position;
             INSERT INTO explorer_move SELECT * FROM part.explorer_move;",
        )
        .expect("merge part");
        db.execute("DETACH part", []).expect("detach");
        fs::remove_file(&part).ok();
    }
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

fn game_spans(bytes: &[u8], limit: u64) -> Vec<(usize, usize)> {
    let mut spans = Vec::with_capacity(bytes.len() / 1800);
    let mut i = 0;
    let n = bytes.len();
    while i < n {
        while i < n && bytes[i] != b'[' {
            i += 1;
        }
        if i >= n {
            break;
        }
        let start = i;
        let mut end = n;
        let mut j = i + 1;
        while j + 2 < n {
            if bytes[j] == b'\n' && bytes[j + 1] == b'\n' && bytes[j + 2] == b'[' {
                end = j;
                break;
            }
            j += 1;
        }
        spans.push((start, end));
        if limit > 0 && spans.len() as u64 >= limit {
            break;
        }
        i = if end < n { end + 2 } else { n };
    }
    spans
}

fn pass1_bytes(
    bytes: &[u8],
    spans: &[(usize, usize)],
    workers: usize,
) -> (Arc<Sketch>, Arc<Sketch>) {
    let pos = Arc::new(Sketch::new());
    let mov = Arc::new(Sketch::new());
    let workers = workers.max(1);
    let chunk = spans.len().div_ceil(workers);
    std::thread::scope(|scope| {
        for worker in 0..workers {
            let start = worker * chunk;
            if start >= spans.len() {
                break;
            }
            let end = ((worker + 1) * chunk).min(spans.len());
            let pos = Arc::clone(&pos);
            let mov = Arc::clone(&mov);
            let spans = &spans[start..end];
            scope.spawn(move || {
                let mut cleaned = String::new();
                let mut uci_buf = String::new();
                for &(from, to) in spans {
                    let Ok(game) = std::str::from_utf8(&bytes[from..to]) else {
                        continue;
                    };
                    if let Some(kept) = consider(game) {
                        walk_sketch(&kept, &mut cleaned, &mut uci_buf, &pos, &mov);
                    }
                }
            });
        }
    });
    (pos, mov)
}

fn pass2_bytes(
    bytes: &[u8],
    spans: &[(usize, usize)],
    pos_sketch: Arc<Sketch>,
    mov_sketch: Arc<Sketch>,
    threshold: u64,
    data: &Path,
    workers: usize,
) {
    // Parsers and shard threads share the same cores. Splitting the machine
    // between them beats starting one of each per core.
    let workers = workers.max(1);
    let mut txs = Vec::new();
    let mut handles = Vec::new();
    for _ in 0..workers {
        let (tx, rx) = bounded::<ShardMsg>(8);
        txs.push(tx);
        handles.push(std::thread::spawn(move || shard_loop(rx)));
    }
    let started = Instant::now();
    let chunk = spans.len().div_ceil(workers);
    std::thread::scope(|scope| {
        for worker in 0..workers {
            let start = worker * chunk;
            if start >= spans.len() {
                break;
            }
            let end = ((worker + 1) * chunk).min(spans.len());
            let txs = txs.clone();
            let pos_sketch = Arc::clone(&pos_sketch);
            let mov_sketch = Arc::clone(&mov_sketch);
            let spans = &spans[start..end];
            scope.spawn(move || {
                let mut parser = Parser::new(txs.len(), threshold as u16);
                for &(from, to) in spans {
                    let Ok(game) = std::str::from_utf8(&bytes[from..to]) else {
                        continue;
                    };
                    if let Some(kept) = consider(game) {
                        parser.walk(&kept, &txs, &pos_sketch, &mov_sketch);
                    }
                }
                parser.finish(&txs);
            });
        }
    });
    drop(txs);
    let shards: Vec<Shard> = handles
        .into_iter()
        .map(|handle| handle.join().expect("shard"))
        .collect();
    drop(pos_sketch);
    drop(mov_sketch);
    println!(
        "{{\"pass\":2,\"counted\":true,\"queued\":{},\"seconds\":{:.3}}}",
        spans.len(),
        started.elapsed().as_secs_f64()
    );
    let write_started = Instant::now();
    write_compact(data, &shards, threshold);
    println!(
        "{{\"pass\":2,\"wroteSec\":{:.3}}}",
        write_started.elapsed().as_secs_f64()
    );
}

fn run_pgn_bytes(file: &Path, pass: &str, limit: u64, threshold: u64, data: &Path, workers: usize) {
    let started = Instant::now();
    let bytes = fs::read(file).expect("read pgn");
    let spans = game_spans(&bytes, limit);
    println!(
        "{{\"loadedGames\":{},\"readSec\":{:.3}}}",
        spans.len(),
        started.elapsed().as_secs_f64()
    );
    let mut sketches = None;
    if pass == "1" || pass == "all" {
        let walk = Instant::now();
        let (pos, mov) = pass1_bytes(&bytes, &spans, workers);
        println!(
            "{{\"pass\":1,\"counted\":true,\"queued\":{},\"seconds\":{:.3}}}",
            spans.len(),
            walk.elapsed().as_secs_f64()
        );
        if pass == "1" {
            pos.save(&data.join("explorer-sketch-position.bin"));
            mov.save(&data.join("explorer-sketch-move.bin"));
        } else {
            sketches = Some((pos, mov));
        }
    }
    if pass == "2" || pass == "all" {
        let (pos, mov) = sketches.unwrap_or_else(|| {
            (
                Arc::new(Sketch::load(&data.join("explorer-sketch-position.bin"))),
                Arc::new(Sketch::load(&data.join("explorer-sketch-move.bin"))),
            )
        });
        pass2_bytes(&bytes, &spans, pos, mov, threshold, data, workers);
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

    if file.to_string_lossy().ends_with(".pgn") {
        run_pgn_bytes(&file, &pass, limit, threshold, &data, workers);
        return;
    }
    if pass == "1" || pass == "all" {
        run_pass(&file, limit, &data, workers);
    }
    if pass == "2" || pass == "all" {
        run_fast_pass(&file, limit, threshold, &data, workers);
    }
}
