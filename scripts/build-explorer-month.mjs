/**
 * Count one Lichess monthly dump into explorer_position and explorer_move.
 *
 * Pass 1 streams the .pgn.zst and tallies every board and move in a fixed
 * sketch. Pass 2 counts exactly the lines the sketch says were played at
 * least 100 times, across every speed and rating band, then drops the rest.
 * `--pass upload` copies the kept rows to Turso. `--pass all` does every step.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { createClient } from '@libsql/client'
import { DatabaseSync } from 'node:sqlite'
import { START_EPD, parseSpill, sketchBytes, viewsFrom } from './explorer-game.mjs'

const ZSTD = '/opt/homebrew/bin/zstd'
const DATA = path.join(process.cwd(), '.data')
const SKETCH = {
  position: path.join(DATA, 'explorer-sketch-position.bin'),
  move: path.join(DATA, 'explorer-sketch-move.bin'),
}
const META = path.join(DATA, 'explorer-pass1.json')
const SCRATCH = path.join(DATA, 'explorer-2026-09.sqlite')

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) return fallback ?? true
  return value
}

const file =
  arg('file') ||
  path.join(process.env.HOME || '', 'Downloads', 'lichess_db_standard_rated_2026-09.pgn.zst')
const month = arg('month', '2026-09')
const pass = arg('pass', 'all')
const limit = arg('limit') ? Number(arg('limit')) : 0
const threshold = arg('threshold') ? Number(arg('threshold')) : 100

function log(event) {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...event }))
}

function workerCount() {
  return os.availableParallelism?.() || os.cpus().length
}

function emptyShared() {
  const sab = new SharedArrayBuffer(sketchBytes())
  return { sab, views: viewsFrom(sab) }
}

function saveSketch(filePath, views) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const handle = fs.openSync(filePath, 'w')
  try {
    for (const view of views) {
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
      fs.writeSync(handle, bytes)
    }
  } finally {
    fs.closeSync(handle)
  }
}

function loadShared(filePath) {
  const expected = sketchBytes()
  const size = fs.statSync(filePath).size
  if (size !== expected) throw new Error(`${filePath} is ${size} bytes, expected ${expected}`)
  const shared = emptyShared()
  const handle = fs.openSync(filePath, 'r')
  try {
    let offset = 0
    for (const view of shared.views) {
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
      const read = fs.readSync(handle, bytes, 0, bytes.byteLength, offset)
      if (read !== bytes.byteLength) throw new Error(`short read ${filePath}`)
      offset += read
    }
  } finally {
    fs.closeSync(handle)
  }
  return shared
}

function eachGame(onGame) {
  return new Promise((resolve, reject) => {
    const child = spawn(ZSTD, ['-dc', file], { stdio: ['ignore', 'pipe', 'inherit'] })
    let buf = ''
    let games = 0
    let stopped = false
    let chain = Promise.resolve()
    const decoder = new TextDecoder()
    const finish = (err) => {
      if (stopped) return
      stopped = true
      child.kill('SIGTERM')
      if (err) reject(err)
      else resolve(games)
    }
    const drain = async (final) => {
      child.stdout.pause()
      while (!stopped) {
        const index = buf.indexOf('\n\n[')
        if (index < 0) break
        const game = buf.slice(0, index)
        buf = buf.slice(index + 2)
        if (!game.startsWith('[')) continue
        games += 1
        await onGame(game, games)
        if (limit && games >= limit) {
          finish()
          return
        }
      }
      if (final && !stopped && buf.startsWith('[')) {
        games += 1
        await onGame(buf, games)
        buf = ''
      }
      if (!stopped && !final) child.stdout.resume()
    }
    child.stdout.on('data', (chunk) => {
      if (stopped) return
      buf += decoder.decode(chunk, { stream: true })
      chain = chain.then(() => drain(false)).catch((err) => finish(err))
    })
    child.on('error', (err) => finish(err))
    child.on('close', () => {
      chain = chain.then(async () => {
        if (stopped) return
        buf += decoder.decode()
        await drain(true)
        finish()
      }).catch((err) => finish(err))
    })
  })
}

function openWorkers(mode, posSab, moveSab, onFlush) {
  const count = workerCount()
  const workers = []
  const free = []
  const queue = []
  const results = []
  const idle = []
  const sizes = new Map()
  let streamEnded = false
  let ended = 0
  let resolveDone
  const done = new Promise((resolve) => {
    resolveDone = resolve
  })

  function release() {
    if (queue.length < 24) while (idle.length) idle.shift()()
  }

  function kick() {
    while (free.length && queue.length) free.pop().postMessage(queue.shift())
    release()
    if (streamEnded && queue.length === 0 && free.length === count && ended === 0) {
      for (const worker of workers) worker.postMessage({ end: true })
    }
  }

  for (let i = 0; i < count; i += 1) {
    const worker = new Worker(new URL('./explorer-count-worker.mjs', import.meta.url), {
      workerData: {
        mode,
        threshold,
        pos: posSab,
        move: moveSab,
        spillPos: mode === '2' ? path.join(DATA, `explorer-spill-pos-${i}.bin`) : '',
        spillMove: mode === '2' ? path.join(DATA, `explorer-spill-move-${i}.bin`) : '',
      },
      resourceLimits: { maxOldGenerationSizeMb: 2048 },
    })
    workers.push(worker)
    free.push(worker)
    worker.on('message', (msg) => {
      if (msg.flush && onFlush) {
        try {
          onFlush(msg)
        } catch (err) {
          console.error(err)
          process.exit(1)
        }
      }
      if (msg.end) {
        ended += 1
        if (ended === count) resolveDone(results)
        return
      }
      if (typeof msg.positions === 'number') sizes.set(worker, msg)
      else if (msg.flush) sizes.set(worker, { positions: 0, moves: 0 })
      free.push(worker)
      kick()
    })
    worker.on('error', (err) => {
      console.error(err)
      process.exit(1)
    })
  }

  return {
    count,
    keySizes() {
      let positions = 0
      let moves = 0
      let spill = 0
      for (const msg of sizes.values()) {
        positions += msg.positions || 0
        moves += msg.moves || 0
        spill += msg.spill || 0
      }
      return { positions, moves, spillMB: Math.round(spill / 1024 / 1024) }
    },
    async push(game) {
      queue.push(game)
      kick()
      if (queue.length < 48) return
      await new Promise((resolve) => idle.push(resolve))
    },
    async finish() {
      streamEnded = true
      kick()
      const out = await done
      await Promise.all(workers.map((worker) => worker.terminate()))
      return out
    },
  }
}

async function pass1() {
  fs.mkdirSync(DATA, { recursive: true })
  fs.writeFileSync(META, JSON.stringify({ games: 0, month, limit, complete: false }))
  log({
    pass: 1,
    file,
    month,
    limit: limit || null,
    workers: workerCount(),
    sketchBytes: sketchBytes() * 2,
  })
  const positions = emptyShared()
  const moves = emptyShared()
  const pool = openWorkers('1', positions.sab, moves.sab)
  const started = Date.now()
  const games = await eachGame(async (game, seen) => {
    await pool.push(game)
    if (seen % 100000 === 0) {
      const seconds = (Date.now() - started) / 1000
      log({ seen, seconds: Math.round(seconds), perSec: Math.round(seen / seconds) })
    }
  })
  await pool.finish()
  log({ pass: 1, counted: true, games, seconds: Math.round((Date.now() - started) / 1000) })
  saveSketch(SKETCH.position, positions.views)
  saveSketch(SKETCH.move, moves.views)
  fs.mkdirSync(DATA, { recursive: true })
  fs.writeFileSync(
    META,
    JSON.stringify({ games, width: 2 ** 28, depth: 4, month, limit, complete: true }),
  )
  log({ pass: 1, done: true, games, seconds: Math.round((Date.now() - started) / 1000) })
}

function merge(results) {
  const positions = new Map()
  const moves = new Map()
  const sans = new Map()
  const add = (map, key, cell) => {
    const current = map.get(key)
    if (!current) {
      map.set(key, [cell[0], cell[1], cell[2]])
      return
    }
    current[0] += cell[0]
    current[1] += cell[1]
    current[2] += cell[2]
  }
  for (const result of results) {
    for (const [key, cell] of result.positions) add(positions, key, cell)
    for (const [key, cell] of result.moves) add(moves, key, cell)
    for (const [key, san] of result.sans) if (!sans.has(key)) sans.set(key, san)
  }
  return { positions, moves, sans }
}

async function pass2() {
  if (!fs.existsSync(META)) throw new Error('Run pass 1 first.')
  const meta = JSON.parse(fs.readFileSync(META, 'utf8'))
  if (!meta.complete) throw new Error('Pass 1 did not finish.')
  if ((limit || 0) !== (meta.limit || 0)) {
    throw new Error(`Pass 1 used --limit ${meta.limit || 'all'}. Pass 2 must use the same limit.`)
  }
  log({ pass: 2, threshold, workers: workerCount() })
  for (const name of fs.readdirSync(DATA)) {
    if (name.startsWith('explorer-spill-')) fs.rmSync(path.join(DATA, name))
  }
  const positions = loadShared(SKETCH.position)
  const moves = loadShared(SKETCH.move)
  const scratch = openScratch()
  const pool = openWorkers('2', positions.sab, moves.sab)
  const started = Date.now()
  await eachGame(async (game, seen) => {
    await pool.push(game)
    if (seen % 100000 === 0) {
      const seconds = (Date.now() - started) / 1000
      const sizes = pool.keySizes()
      log({
        seen,
        seconds: Math.round(seconds),
        perSec: Math.round(seen / seconds),
        ...sizes,
      })
      if (sizes.spillMB > 12 * 1024) {
        throw new Error('Spill files passed 12 GB. Stopping so the disk does not fill up.')
      }
    }
  })
  await pool.finish()
  log({ pass: 2, counted: true, seconds: Math.round((Date.now() - started) / 1000) })
  scratch.absorbSpills()
  scratch.finish()
}

function splitKey(key, parts) {
  const bits = key.split('|')
  if (parts === 3) return [bits[0], bits[1], bits.slice(2).join('|')]
  const uci = bits.at(-1)
  return [bits[0], bits[1], bits.slice(2, -1).join('|'), uci]
}

function openScratch() {
  fs.mkdirSync(DATA, { recursive: true })
  if (fs.existsSync(SCRATCH)) fs.rmSync(SCRATCH)
  const db = new DatabaseSync(SCRATCH)
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA locking_mode = EXCLUSIVE;
    CREATE TABLE explorer_position (
      speed TEXT NOT NULL,
      rating_band TEXT NOT NULL,
      position TEXT NOT NULL,
      white INTEGER NOT NULL,
      draws INTEGER NOT NULL,
      black INTEGER NOT NULL,
      PRIMARY KEY (speed, rating_band, position)
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
      PRIMARY KEY (speed, rating_band, position, uci)
    );
  `)
  const insertPos = db.prepare(
    `INSERT INTO explorer_position (speed, rating_band, position, white, draws, black)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (speed, rating_band, position) DO UPDATE SET
       white = white + excluded.white,
       draws = draws + excluded.draws,
       black = black + excluded.black`,
  )
  const insertMove = db.prepare(
    `INSERT INTO explorer_move (speed, rating_band, position, uci, san, white, draws, black)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (speed, rating_band, position, uci) DO UPDATE SET
       white = white + excluded.white,
       draws = draws + excluded.draws,
       black = black + excluded.black`,
  )
  return {
    apply(positions, moves, sans) {
      const sanOf = new Map(sans)
      db.exec('BEGIN')
      for (const [key, cell] of positions) {
        const [speed, band, fen] = splitKey(key, 3)
        insertPos.run(speed, band, fen, cell[0], cell[1], cell[2])
      }
      for (const [key, cell] of moves) {
        const [speed, band, fen, uci] = splitKey(key, 4)
        insertMove.run(speed, band, fen, uci, sanOf.get(key) || uci, cell[0], cell[1], cell[2])
      }
      db.exec('COMMIT')
    },
    absorbSpills() {
      loadGrouped(db, 'explorer_position', spillFiles('explorer-spill-pos-'), false)
      loadGrouped(db, 'explorer_move', spillFiles('explorer-spill-move-'), true)
    },
    finish() {
      finishScratch(db)
    },
  }
}

function spillFiles(prefix) {
  return fs
    .readdirSync(DATA)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.bin'))
    .map((name) => path.join(DATA, name))
}

function forEachSpill(file, onRecord) {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    let offset = 0
    let pending = Buffer.alloc(0)
    const chunk = Buffer.allocUnsafe(1024 * 1024)
    while (offset < size) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, offset)
      if (!n) break
      offset += n
      const piece = chunk.subarray(0, n)
      pending = pending.length ? Buffer.concat([pending, piece]) : Buffer.from(piece)
      const used = parseSpill(pending, onRecord)
      if (!used && pending.length > 1024 * 1024) throw new Error(`bad spill record in ${file}`)
      pending = Buffer.from(pending.subarray(used))
    }
    if (pending.length) throw new Error(`truncated spill ${file}`)
  } finally {
    fs.closeSync(fd)
  }
}

function loadGrouped(finalDb, table, files, isMove) {
  const rawPath = path.join(DATA, isMove ? 'explorer-move-raw.sqlite' : 'explorer-pos-raw.sqlite')
  const rawTable = isMove ? 'move_raw' : 'pos_raw'
  if (fs.existsSync(rawPath)) fs.rmSync(rawPath)
  const raw = new DatabaseSync(rawPath)
  raw.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA locking_mode = EXCLUSIVE;
    PRAGMA cache_size = -1048576;
    PRAGMA temp_store = FILE;
  `)
  raw.exec(
    isMove
      ? `CREATE TABLE move_raw (
           speed TEXT, rating_band TEXT, position TEXT, uci TEXT, san TEXT,
           white INT, draws INT, black INT
         )`
      : `CREATE TABLE pos_raw (
           speed TEXT, rating_band TEXT, position TEXT,
           white INT, draws INT, black INT
         )`,
  )
  const insert = raw.prepare(
    isMove
      ? `INSERT INTO move_raw (speed, rating_band, position, uci, san, white, draws, black)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      : `INSERT INTO pos_raw (speed, rating_band, position, white, draws, black)
         VALUES (?, ?, ?, ?, ?, ?)`,
  )
  let loaded = 0
  raw.exec('BEGIN')
  for (const file of files) {
    forEachSpill(file, (rec) => {
      if (isMove) {
        insert.run(rec.speed, rec.band, rec.fen, rec.uci, rec.san || rec.uci, rec.white, rec.draws, rec.black)
      } else {
        insert.run(rec.speed, rec.band, rec.fen, rec.white, rec.draws, rec.black)
      }
      loaded += 1
      if (loaded % 250000 === 0) {
        raw.exec('COMMIT')
        raw.exec('BEGIN')
        log({ table: rawTable, loaded })
      }
    })
  }
  raw.exec('COMMIT')
  raw.close()
  for (const file of files) fs.rmSync(file, { force: true })
  log({ table: rawTable, loaded, grouping: true })
  finalDb.exec('PRAGMA cache_size = -1048576; PRAGMA temp_store = FILE;')
  finalDb.prepare('ATTACH ? AS rawdb').run(rawPath)
  if (isMove) {
    finalDb.exec(`
      INSERT INTO explorer_move (speed, rating_band, position, uci, san, white, draws, black)
      SELECT speed, rating_band, position, uci, MAX(san), SUM(white), SUM(draws), SUM(black)
      FROM rawdb.move_raw
      GROUP BY speed, rating_band, position, uci
    `)
  } else {
    finalDb.exec(`
      INSERT INTO explorer_position (speed, rating_band, position, white, draws, black)
      SELECT speed, rating_band, position, SUM(white), SUM(draws), SUM(black)
      FROM rawdb.pos_raw
      GROUP BY speed, rating_band, position
    `)
  }
  finalDb.exec('DETACH rawdb')
  fs.rmSync(rawPath)
  log({ table, grouped: true, loaded })
}

function finishScratch(db) {
  const minGames = Number(threshold)
  db.exec(`
    DELETE FROM explorer_position
    WHERE position IN (
      SELECT position FROM explorer_position
      GROUP BY position
      HAVING SUM(white + draws + black) < ${minGames}
    );
    DELETE FROM explorer_move
    WHERE (position || char(31) || uci) IN (
      SELECT position || char(31) || uci FROM explorer_move
      GROUP BY position, uci
      HAVING SUM(white + draws + black) < ${minGames}
    );
  `)
  const posCount = db.prepare('SELECT COUNT(*) AS n FROM explorer_position').get().n
  const moveCount = db.prepare('SELECT COUNT(*) AS n FROM explorer_move').get().n
  const top = db
    .prepare(
      `SELECT san, SUM(white) AS white, SUM(draws) AS draws, SUM(black) AS black
       FROM explorer_move WHERE position = ? GROUP BY san
       ORDER BY SUM(white) * 1.0 / SUM(white + draws + black) DESC LIMIT 8`,
    )
    .all(START_EPD)
  db.close()
  log({ scratch: SCRATCH, positions: posCount, moves: moveCount, startMoves: top })
}

function loadEnv() {
  for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    const filePath = path.join(process.cwd(), name)
    if (!fs.existsSync(filePath)) continue
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const raw = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed
      const eq = raw.indexOf('=')
      if (eq <= 0) continue
      const key = raw.slice(0, eq).trim()
      if (process.env[key]) continue
      let value = raw.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}

async function upload() {
  if (!fs.existsSync(SCRATCH)) throw new Error('Scratch database is missing. Run pass 2 first.')
  loadEnv()
  const url = process.env.TURSO_DATABASE_URL || ''
  const authToken =
    process.env.TURSO_AUTH_TOKEN || process.env.TURSO_DATABASE_TURSO_AUTH_TOKEN || ''
  if (!url || !authToken) throw new Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.')
  const db = new DatabaseSync(SCRATCH, { readOnly: true })
  const posCount = db.prepare('SELECT COUNT(*) AS n FROM explorer_position').get().n
  const moveCount = db.prepare('SELECT COUNT(*) AS n FROM explorer_move').get().n
  log({ upload: true, month, positions: posCount, moves: moveCount })
  const client = createClient({ url, authToken })
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS explorer_position (
        month TEXT NOT NULL,
        speed TEXT NOT NULL,
        rating_band TEXT NOT NULL,
        position TEXT NOT NULL,
        white INTEGER NOT NULL,
        draws INTEGER NOT NULL,
        black INTEGER NOT NULL,
        PRIMARY KEY (month, speed, rating_band, position)
      )`,
      `CREATE TABLE IF NOT EXISTS explorer_move (
        month TEXT NOT NULL,
        speed TEXT NOT NULL,
        rating_band TEXT NOT NULL,
        position TEXT NOT NULL,
        uci TEXT NOT NULL,
        san TEXT NOT NULL,
        white INTEGER NOT NULL,
        draws INTEGER NOT NULL,
        black INTEGER NOT NULL,
        PRIMARY KEY (month, speed, rating_band, position, uci)
      )`,
      { sql: 'DELETE FROM explorer_position WHERE month = ?', args: [month] },
      { sql: 'DELETE FROM explorer_move WHERE month = ?', args: [month] },
    ],
    'write',
  )
  await insertRemote(
    client,
    'explorer_position',
    ['month', 'speed', 'rating_band', 'position', 'white', 'draws', 'black'],
    db.prepare('SELECT speed, rating_band, position, white, draws, black FROM explorer_position'),
    (row) => [month, row.speed, row.rating_band, row.position, row.white, row.draws, row.black],
  )
  await insertRemote(
    client,
    'explorer_move',
    ['month', 'speed', 'rating_band', 'position', 'uci', 'san', 'white', 'draws', 'black'],
    db.prepare('SELECT speed, rating_band, position, uci, san, white, draws, black FROM explorer_move'),
    (row) => [
      month,
      row.speed,
      row.rating_band,
      row.position,
      row.uci,
      row.san,
      row.white,
      row.draws,
      row.black,
    ],
  )
  await client.batch(
    [
      `CREATE INDEX IF NOT EXISTS explorer_position_lookup
       ON explorer_position (position, rating_band, speed, month)`,
      `CREATE INDEX IF NOT EXISTS explorer_move_lookup
       ON explorer_move (position, rating_band, speed, month)`,
    ],
    'write',
  )
  db.close()
  client.close()
  log({ upload: 'done', month, positions: posCount, moves: moveCount })
}

async function insertRemote(client, table, columns, stmt, toArgs) {
  const placeholders = columns.map(() => '?').join(', ')
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
  let batch = []
  let sent = 0
  for (const row of stmt.iterate()) {
    batch.push({ sql, args: toArgs(row) })
    if (batch.length === 200) {
      await client.batch(batch, 'write')
      sent += batch.length
      batch = []
      if (sent % 20000 === 0) log({ table, sent })
    }
  }
  if (batch.length) {
    await client.batch(batch, 'write')
    sent += batch.length
  }
  log({ table, sent })
}

if (pass === '1') await pass1()
else if (pass === '2') await pass2()
else if (pass === 'upload') await upload()
else if (pass === 'all') {
  await pass1()
  await pass2()
  await upload()
} else {
  throw new Error(`Unknown --pass ${pass}`)
}
