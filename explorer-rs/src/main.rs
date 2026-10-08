//! Count one Lichess month into explorer_position and explorer_move.
//!
//! Pass 1 remembers which boards and moves were popular, in a fixed-size sketch.
//! Pass 2 counts those exactly and writes a scratch SQLite file. The website
//! upload is still `npm run build:explorer:upload`.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use crossbeam_channel::{bounded, Sender};
use rusqlite::Connection;
use rustc_hash::FxHashMap;
use shakmaty::san::San;
use shakmaty::uci::UciMove;
use shakmaty::{CastlingMode, CastlingSide, Chess, Color, EnPassantMode, Position};

const WIDTH: usize = 1 << 28;
const DEPTH: usize = 4;
const PLY_CAP: usize = 50;
const SKETCH_BYTES: usize = WIDTH * DEPTH * 2;

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
        let bytes = unsafe {
            std::slice::from_raw_parts(self.cells.as_ptr() as *const u8, SKETCH_BYTES)
        };
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

struct MoveCell {
    counts: [u32; 3],
    san: String,
}

struct Tallies {
    positions: FxHashMap<String, [u32; 3]>,
    moves: FxHashMap<String, MoveCell>,
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

fn bump_move(map: &mut FxHashMap<String, MoveCell>, key: &str, san: &str, outcome: usize) {
    if let Some(cell) = map.get_mut(key) {
        cell.counts[outcome] += 1;
        return;
    }
    let mut counts = [0, 0, 0];
    counts[outcome] = 1;
    map.insert(
        key.to_owned(),
        MoveCell {
            counts,
            san: san.to_owned(),
        },
    );
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
            note_position(mode, key, fen_at, kept.outcome);
            return;
        }
        let mv = parsed.unwrap();
        note_position(mode, key, fen_at, kept.outcome);
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
        note_move(mode, key, fen_at, uci_len, written, kept.outcome);
        pos.play_unchecked(mv);
        played += 1;
    }
    if played == 0 {
        return;
    }
    let fen_at = fill_key(key, kept.speed, kept.band, &pos);
    note_position(mode, key, fen_at, kept.outcome);
}

#[derive(Clone, Copy)]
enum Mode<'a> {
    Pass1 { pos: &'a Sketch, mov: &'a Sketch },
    Pass2 {
        pos: &'a Sketch,
        mov: &'a Sketch,
        tallies: *mut Tallies,
        threshold: u16,
    },
}

fn note_position(mode: Mode<'_>, key: &str, fen_at: usize, outcome: usize) {
    let fen = &key[fen_at..];
    match mode {
        Mode::Pass1 { pos, .. } => pos.add(fen, None),
        Mode::Pass2 { pos, tallies, threshold, .. } => {
            if pos.estimate(fen, None) < threshold {
                return;
            }
            let tallies = unsafe { &mut *tallies };
            bump_pos(&mut tallies.positions, key, outcome);
        }
    }
}

fn note_move(mode: Mode<'_>, key: &str, fen_at: usize, uci_len: usize, san: &str, outcome: usize) {
    let fen_end = key.len() - uci_len - 1;
    let fen = &key[fen_at..fen_end];
    let uci = &key[fen_end + 1..];
    match mode {
        Mode::Pass1 { mov, .. } => mov.add(fen, Some(uci)),
        Mode::Pass2 { mov, tallies, threshold, .. } => {
            if mov.estimate(fen, Some(uci)) < threshold {
                return;
            }
            let tallies = unsafe { &mut *tallies };
            bump_move(&mut tallies.moves, key, san, outcome);
        }
    }
}

fn find_game_end(buf: &[u8]) -> Option<usize> {
    buf.windows(3).position(|window| window == b"\n\n[")
}

fn stream_games(file: &Path, limit: u64, tx: Sender<String>) -> u64 {
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
    let mut stdout = child.stdout.take().expect("zstd stdout");
    let mut buf = Vec::with_capacity(1 << 20);
    let mut tmp = vec![0u8; 1 << 20];
    let mut games = 0u64;
    loop {
        if limit > 0 && games >= limit {
            let _ = child.kill();
            break;
        }
        let n = stdout.read(&mut tmp).expect("read zstd");
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
                    let _ = child.kill();
                    let _ = child.wait();
                    return games;
                }
            }
        }
        if limit > 0 && games >= limit {
            let _ = child.kill();
            break;
        }
    }
    if (limit == 0 || games < limit) && buf.starts_with(b"[") {
        games += 1;
        let _ = tx.send(String::from_utf8_lossy(&buf).into_owned());
    }
    let _ = child.wait();
    games
}

fn worker_loop(
    rx: crossbeam_channel::Receiver<String>,
    pass: u8,
    threshold: u16,
    pos: Arc<Sketch>,
    mov: Arc<Sketch>,
    seen: &AtomicU64,
    started: Instant,
) -> Tallies {
    let mut tallies = Tallies {
        positions: FxHashMap::default(),
        moves: FxHashMap::default(),
    };
    let mut cleaned = String::new();
    let mut key = String::new();
    let mut uci_buf = String::new();
    while let Ok(game) = rx.recv() {
        if let Some(kept) = consider(&game) {
            let mode = if pass == 1 {
                Mode::Pass1 { pos: &pos, mov: &mov }
            } else {
                Mode::Pass2 {
                    pos: &pos,
                    mov: &mov,
                    tallies: &mut tallies as *mut Tallies,
                    threshold,
                }
            };
            walk_game(&kept, &mut cleaned, &mut key, &mut uci_buf, mode);
        }
        let n = seen.fetch_add(1, Ordering::Relaxed) + 1;
        if n % 100_000 == 0 {
            let seconds = started.elapsed().as_secs().max(1);
            println!(
                "{{\"pass\":{pass},\"seen\":{n},\"seconds\":{seconds},\"perSec\":{}}}",
                n / seconds
            );
        }
    }
    tallies
}

fn run_pass(pass: u8, file: &Path, limit: u64, threshold: u16, data: &Path, workers: usize) -> Vec<Tallies> {
    let (pos, mov) = if pass == 1 {
        println!("{{\"pass\":1,\"allocating\":true,\"sketchBytes\":{}}}", SKETCH_BYTES * 2);
        let started = Instant::now();
        let pos = Arc::new(Sketch::new());
        let mov = Arc::new(Sketch::new());
        println!(
            "{{\"pass\":1,\"allocated\":true,\"seconds\":{}}}",
            started.elapsed().as_secs()
        );
        (Some(pos), Some(mov))
    } else {
        println!("{{\"pass\":2,\"loading\":true}}");
        let pos = Arc::new(Sketch::load(&data.join("explorer-sketch-position.bin")));
        let mov = Arc::new(Sketch::load(&data.join("explorer-sketch-move.bin")));
        (Some(pos), Some(mov))
    };
    let (tx, rx) = bounded::<String>(workers * 8);
    let seen = Arc::new(AtomicU64::new(0));
    let started = Instant::now();
    let mut handles = Vec::new();
    for _ in 0..workers {
        let rx = rx.clone();
        let seen = Arc::clone(&seen);
        let pos = pos.clone().expect("position sketch");
        let mov = mov.clone().expect("move sketch");
        handles.push(std::thread::spawn(move || {
            worker_loop(rx, pass, threshold, pos, mov, &seen, started)
        }));
    }
    drop(rx);
    let queued = stream_games(file, limit, tx);
    let tallies: Vec<Tallies> = handles.into_iter().map(|handle| handle.join().expect("worker")).collect();
    if pass == 1 {
        if let (Some(pos), Some(mov)) = (pos, mov) {
            pos.save(&data.join("explorer-sketch-position.bin"));
            mov.save(&data.join("explorer-sketch-move.bin"));
        }
    }
    let seconds = started.elapsed().as_secs();
    println!(
        "{{\"pass\":{pass},\"counted\":true,\"queued\":{queued},\"seconds\":{seconds}}}"
    );
    tallies
}

fn merge_pos(parts: &mut [Tallies]) -> FxHashMap<String, [u32; 3]> {
    let mut acc = FxHashMap::default();
    for part in parts {
        for (key, cell) in part.positions.drain() {
            acc.entry(key)
                .and_modify(|cur: &mut [u32; 3]| {
                    cur[0] += cell[0];
                    cur[1] += cell[1];
                    cur[2] += cell[2];
                })
                .or_insert(cell);
        }
    }
    acc
}

fn merge_moves(parts: &mut [Tallies]) -> FxHashMap<String, MoveCell> {
    let mut acc = FxHashMap::default();
    for part in parts {
        for (key, cell) in part.moves.drain() {
            match acc.entry(key) {
                std::collections::hash_map::Entry::Occupied(mut entry) => {
                    let cur: &mut MoveCell = entry.get_mut();
                    cur.counts[0] += cell.counts[0];
                    cur.counts[1] += cell.counts[1];
                    cur.counts[2] += cell.counts[2];
                }
                std::collections::hash_map::Entry::Vacant(entry) => {
                    entry.insert(cell);
                }
            }
        }
    }
    acc
}

fn fen_of<'a>(key: &'a str, parts: usize) -> &'a str {
    let mut rest = key;
    for _ in 0..2 {
        rest = rest.split_once('|').map(|(_, tail)| tail).unwrap_or(rest);
    }
    if parts == 3 {
        rest
    } else {
        rest.rsplit_once('|').map(|(fen, _)| fen).unwrap_or(rest)
    }
}

fn keep_over(totals: &FxHashMap<String, u64>, key: &str, threshold: u64, parts: usize) -> bool {
    let group = if parts == 3 {
        fen_of(key, 3).to_owned()
    } else {
        let fen = fen_of(key, 4);
        let uci = key.rsplit_once('|').map(|(_, uci)| uci).unwrap_or("");
        format!("{fen}|{uci}")
    };
    totals.get(&group).copied().unwrap_or(0) >= threshold
}

fn group_totals(keys: impl Iterator<Item = (String, u64)>, parts: usize) -> FxHashMap<String, u64> {
    let mut totals = FxHashMap::default();
    for (key, games) in keys {
        let group = if parts == 3 {
            fen_of(&key, 3).to_owned()
        } else {
            let fen = fen_of(&key, 4);
            let uci = key.rsplit_once('|').map(|(_, uci)| uci).unwrap_or("");
            format!("{fen}|{uci}")
        };
        *totals.entry(group).or_insert(0) += games;
    }
    totals
}

fn write_sqlite(data: &Path, positions: FxHashMap<String, [u32; 3]>, moves: FxHashMap<String, MoveCell>, threshold: u64) {
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

    let pos_totals = group_totals(
        positions.iter().map(|(key, cell)| (key.clone(), (cell[0] + cell[1] + cell[2]) as u64)),
        3,
    );
    let move_totals = group_totals(
        moves.iter().map(|(key, cell)| {
            (key.clone(), (cell.counts[0] + cell.counts[1] + cell.counts[2]) as u64)
        }),
        4,
    );

    let tx = db.transaction().expect("tx");
    {
        let mut insert = tx
            .prepare(
                "INSERT INTO explorer_position (speed, rating_band, position, white, draws, black)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .expect("prepare pos");
        for (key, cell) in &positions {
            if !keep_over(&pos_totals, key, threshold, 3) {
                continue;
            }
            let (speed, rest) = key.split_once('|').unwrap();
            let (band, fen) = rest.split_once('|').unwrap();
            insert
                .execute((speed, band, fen, cell[0], cell[1], cell[2]))
                .expect("insert pos");
        }
    }
    {
        let mut insert = tx
            .prepare(
                "INSERT INTO explorer_move (speed, rating_band, position, uci, san, white, draws, black)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .expect("prepare move");
        for (key, cell) in &moves {
            if !keep_over(&move_totals, key, threshold, 4) {
                continue;
            }
            let (speed, rest) = key.split_once('|').unwrap();
            let (band, rest) = rest.split_once('|').unwrap();
            let (fen, uci) = rest.rsplit_once('|').unwrap();
            insert
                .execute((
                    speed,
                    band,
                    fen,
                    uci,
                    cell.san.as_str(),
                    cell.counts[0],
                    cell.counts[1],
                    cell.counts[2],
                ))
                .expect("insert move");
        }
    }
    tx.commit().expect("commit");
    let pos_n: i64 = db.query_row("SELECT COUNT(*) FROM explorer_position", [], |row| row.get(0)).unwrap();
    let move_n: i64 = db.query_row("SELECT COUNT(*) FROM explorer_move", [], |row| row.get(0)).unwrap();
    println!("{{\"scratch\":\"{}\",\"positions\":{pos_n},\"moves\":{move_n}}}", path.display());
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
        let mv = San::from_ascii(san.as_bytes()).unwrap().to_move(&pos).unwrap();
        pos.play_unchecked(mv);
        key.clear();
        append_epd(&pos, &mut key);
        println!("{san} {key}");
    }
}

fn main() {
    let pass = arg("pass").unwrap_or_else(|| "all".to_owned());
    let file = arg("file").map(PathBuf::from).unwrap_or_else(|| {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_owned());
        PathBuf::from(home).join("Downloads/lichess_db_standard_rated_2026-09.pgn.zst")
    });
    let limit = arg("limit").and_then(|value| value.parse().ok()).unwrap_or(0);
    let threshold = arg("threshold").and_then(|value| value.parse().ok()).unwrap_or(100u64);
    let data = PathBuf::from(".data");
    fs::create_dir_all(&data).ok();
    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(8);
    if pass == "fen" {
        dump_line(&["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4"]);
        dump_line(&["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O"]);
        return;
    }
    println!(
        "{{\"file\":\"{}\",\"pass\":\"{pass}\",\"limit\":{limit},\"threshold\":{threshold},\"workers\":{workers}}}",
        file.display()
    );

    if pass == "1" || pass == "all" {
        let _ = run_pass(1, &file, limit, threshold as u16, &data, workers);
    }
    if pass == "2" || pass == "all" {
        let mut tallies = run_pass(2, &file, limit, threshold as u16, &data, workers);
        println!("{{\"pass\":2,\"merging\":true}}");
        let positions = merge_pos(&mut tallies);
        let moves = merge_moves(&mut tallies);
        println!(
            "{{\"pass\":2,\"merged\":true,\"positions\":{},\"moves\":{}}}",
            positions.len(),
            moves.len()
        );
        write_sqlite(&data, positions, moves, threshold);
    }
}
