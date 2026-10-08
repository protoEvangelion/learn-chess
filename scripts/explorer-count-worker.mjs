import fs from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import {
  bodyOf,
  consider,
  encodeCell,
  forEachPly,
  hashParts,
  headersOf,
  sketchAddAtomic,
  sketchEstimate,
  viewsFrom,
} from './explorer-game.mjs'

const mode = workerData.mode
const threshold = workerData.threshold
const positions = viewsFrom(workerData.pos)
const moves = viewsFrom(workerData.move)
const HOLD = 2_000_000
const KEEP = 1_200_000
const exactPositions = new Map()
const exactMoves = new Map()
const sans = new Map()

function openSpill(file) {
  if (!file) return null
  return { fd: fs.openSync(file, 'w'), buf: Buffer.allocUnsafe(1024 * 1024), o: 0, bytes: 0 }
}

const spillPos = openSpill(workerData.spillPos)
const spillMove = openSpill(workerData.spillMove)

function bump(map, key, outcome) {
  let cell = map.get(key)
  if (cell) map.delete(key)
  else cell = [0, 0, 0]
  cell[outcome] += 1
  map.set(key, cell)
}

function writeRecord(spill, record) {
  if (spill.o + record.length > spill.buf.length) flushSpill(spill)
  if (record.length > spill.buf.length) {
    fs.writeSync(spill.fd, record)
    spill.bytes += record.length
    return
  }
  record.copy(spill.buf, spill.o)
  spill.o += record.length
}

function flushSpill(spill) {
  if (!spill || !spill.o) return
  fs.writeSync(spill.fd, spill.buf, 0, spill.o)
  spill.bytes += spill.o
  spill.o = 0
}

function evictOne(map, kind) {
  const key = map.keys().next().value
  const cell = map.get(key)
  map.delete(key)
  const bar = key.indexOf('|')
  const bar2 = key.indexOf('|', bar + 1)
  const speed = key.slice(0, bar)
  const band = key.slice(bar + 1, bar2)
  if (kind === 1) {
    writeRecord(spillPos, encodeCell(1, speed, band, key.slice(bar2 + 1), cell))
    return
  }
  const bar3 = key.lastIndexOf('|')
  const san = sans.get(key) || ''
  sans.delete(key)
  writeRecord(
    spillMove,
    encodeCell(2, speed, band, key.slice(bar2 + 1, bar3), cell, key.slice(bar3 + 1), san),
  )
}

function spillCold() {
  while (exactPositions.size + exactMoves.size > KEEP) {
    if (exactPositions.size >= exactMoves.size && exactPositions.size) evictOne(exactPositions, 1)
    else evictOne(exactMoves, 2)
  }
  flushSpill(spillPos)
  flushSpill(spillMove)
}

function count(game) {
  const kept = consider(headersOf(game))
  if (!kept) return
  const { speed, band, outcome } = kept
  forEachPly(
    bodyOf(game),
    (fen) => {
      const [h1, h2] = hashParts([fen])
      if (mode === '1') {
        sketchAddAtomic(positions, h1, h2)
        return
      }
      if (sketchEstimate(positions, h1, h2) < threshold) return
      bump(exactPositions, `${speed}|${band}|${fen}`, outcome)
    },
    (fen, uci, san) => {
      const [h1, h2] = hashParts([fen, uci])
      if (mode === '1') {
        sketchAddAtomic(moves, h1, h2)
        return
      }
      if (sketchEstimate(moves, h1, h2) < threshold) return
      const key = `${speed}|${band}|${fen}|${uci}`
      bump(exactMoves, key, outcome)
      if (!sans.has(key)) sans.set(key, san)
    },
  )
  if (mode === '2' && exactPositions.size + exactMoves.size > HOLD) spillCold()
}

parentPort.on('message', (message) => {
  if (message && message.end) {
    if (mode === '2') {
      while (exactPositions.size) evictOne(exactPositions, 1)
      while (exactMoves.size) evictOne(exactMoves, 2)
      flushSpill(spillPos)
      flushSpill(spillMove)
      fs.closeSync(spillPos.fd)
      fs.closeSync(spillMove.fd)
    }
    parentPort.postMessage({
      end: true,
      spill: spillPos ? spillPos.bytes + spillMove.bytes : 0,
    })
    return
  }
  count(message)
  parentPort.postMessage(
    mode === '2'
      ? {
          ok: true,
          positions: exactPositions.size,
          moves: exactMoves.size,
          spill: spillPos.bytes + spillMove.bytes,
        }
      : { ok: true },
  )
})
