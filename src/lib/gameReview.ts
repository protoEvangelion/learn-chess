import { Chess } from 'chess.js'
import type { Color } from '@logic/pieces'
import { isPawn } from '@logic/pieces/pawn'
import type { HistoryItem } from '@/state/game'
import { boardToFen, positionToSquare } from '@/lib/fenBridge'
import {
  REVIEW_ANALYSIS,
  stockfishOpponent,
  type BestMoveResult,
} from '@/lib/stockfishOpponent'

/** Visual report classifications (v1 — no brilliant/critical/miss). */
export type MoveQualityTag =
  | 'best'
  | 'excellent'
  | 'okay'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'theory'

/** Tags accepted by the coach /api/review payload. */
export type CoachMoveQualityTag =
  | 'best'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'

export const REPORT_TAG_ORDER: MoveQualityTag[] = [
  'best',
  'excellent',
  'okay',
  'inaccuracy',
  'mistake',
  'blunder',
  'theory',
]

export const TAG_LABEL: Record<MoveQualityTag, string> = {
  best: 'Best',
  excellent: 'Excellent',
  okay: 'Okay',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
  theory: 'Theory',
}

/** Rough accuracy contribution per classified move (0–100). */
const TAG_ACCURACY: Record<MoveQualityTag, number> = {
  best: 100,
  excellent: 95,
  okay: 85,
  theory: 100,
  inaccuracy: 60,
  mistake: 35,
  blunder: 0,
}

/** Opening book length (plies) treated as theory when loss is tiny. */
const THEORY_PLY_CAP = 8
const THEORY_MAX_LOSS_CP = 15

export type ReviewPly = {
  ply: number
  fen: string
  san: string
  by: 'player' | 'opponent'
  color: Color
  tag?: MoveQualityTag
  /** Centipawn loss for the side that moved (0 = best). */
  lossCp?: number
  /** Eval after the move, White-pov pawns (mates clamped). */
  evalPawns?: number
  playedEval?: string
  bestSan?: string
  bestEval?: string
}

export type ReviewOutcome = 'win' | 'loss' | 'draw'

export type SideCounts = Record<MoveQualityTag, number>

export type ReportSummary = {
  whiteAccuracy: number | null
  blackAccuracy: number | null
  whiteCounts: SideCounts
  blackCounts: SideCounts
  /** Eval after each ply, White-pov pawns, for the graph. */
  evalSeries: Array<{ ply: number; pawns: number }>
}

export type AnalysisReport = {
  plies: ReviewPly[]
  summary: ReportSummary
  whiteName: string | null
  blackName: string | null
  playerColor: Color
}

function emptyCounts(): SideCounts {
  return {
    best: 0,
    excellent: 0,
    okay: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
    theory: 0,
  }
}

function sideScore(line: BestMoveResult, side: Color): number | null {
  if (line.whiteMate != null) {
    const mate = side === 'white' ? line.whiteMate : -line.whiteMate
    return mate > 0 ? 10000 - mate : -10000 - mate
  }
  if (line.whiteCp == null) return null
  return side === 'white' ? line.whiteCp : -line.whiteCp
}

function evalToPawns(line: BestMoveResult | null): number | null {
  if (!line) return null
  if (line.whiteMate != null) {
    return line.whiteMate > 0 ? 5 : -5
  }
  if (line.whiteCp == null) return null
  return Math.max(-5, Math.min(5, line.whiteCp / 100))
}

function tagFromLossCp(
  lossCp: number,
  missedMate: boolean,
  plyIndex: number,
): MoveQualityTag {
  if (missedMate) return 'blunder'
  if (lossCp >= 200) return 'blunder'
  if (lossCp >= 100) return 'mistake'
  if (lossCp >= 50) return 'inaccuracy'
  if (
    plyIndex < THEORY_PLY_CAP &&
    lossCp <= THEORY_MAX_LOSS_CP
  ) {
    return 'theory'
  }
  if (lossCp <= 5) return 'best'
  if (lossCp <= 20) return 'excellent'
  return 'okay'
}

export function toCoachTag(tag?: MoveQualityTag): CoachMoveQualityTag | undefined {
  if (!tag) return undefined
  if (tag === 'inaccuracy' || tag === 'mistake' || tag === 'blunder') return tag
  return 'best'
}

function playedUci(item: HistoryItem): string {
  const from = positionToSquare(item.from)
  const to = positionToSquare(item.to)
  const promo =
    isPawn(item.piece) && (item.to.y === 0 || item.to.y === 7) ? 'q' : ''
  return `${from}${to}${promo}`
}

function sanForMove(fen: string, item: HistoryItem): string {
  const from = positionToSquare(item.from)
  const to = positionToSquare(item.to)
  try {
    const chess = new Chess(fen)
    const played = chess.move({
      from,
      to,
      promotion: isPawn(item.piece) && (item.to.y === 0 || item.to.y === 7)
        ? 'q'
        : undefined,
    })
    return played?.san ?? `${from}→${to}`
  } catch {
    return `${from}→${to}`
  }
}

function sanForUci(fen: string, uci: string): string | undefined {
  if (uci.length < 4) return undefined
  try {
    const chess = new Chess(fen)
    const played = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    })
    return played?.san
  } catch {
    return undefined
  }
}

/** One row per played move: FEN before the move + SAN. */
export function buildPlyTimeline(
  history: HistoryItem[],
  playerColor: Color,
): ReviewPly[] {
  return history.map((item, i) => {
    const turn = item.piece.color
    const fen = boardToFen(item.board, turn, history.slice(0, i))
    return {
      ply: i + 1,
      fen,
      san: sanForMove(fen, item),
      by: turn === playerColor ? 'player' : 'opponent',
      color: turn,
    }
  })
}

async function evalFen(
  fen: string,
  signal?: AbortSignal,
): Promise<BestMoveResult | null> {
  try {
    const { lines } = await stockfishOpponent.getBestMove(fen, signal, {
      depth: REVIEW_ANALYSIS.depth,
      multiPv: REVIEW_ANALYSIS.multiPv,
    })
    return lines[0] ?? null
  } catch {
    return null
  }
}

export function buildReportSummary(plies: ReviewPly[]): ReportSummary {
  const whiteCounts = emptyCounts()
  const blackCounts = emptyCounts()
  const whiteScores: number[] = []
  const blackScores: number[] = []
  const evalSeries: Array<{ ply: number; pawns: number }> = []

  for (const ply of plies) {
    if (ply.evalPawns != null) {
      evalSeries.push({ ply: ply.ply, pawns: ply.evalPawns })
    }
    if (!ply.tag) continue
    if (ply.color === 'white') {
      whiteCounts[ply.tag] += 1
      whiteScores.push(TAG_ACCURACY[ply.tag])
    } else {
      blackCounts[ply.tag] += 1
      blackScores.push(TAG_ACCURACY[ply.tag])
    }
  }

  const avg = (xs: number[]) =>
    xs.length === 0
      ? null
      : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10

  return {
    whiteAccuracy: avg(whiteScores),
    blackAccuracy: avg(blackScores),
    whiteCounts,
    blackCounts,
    evalSeries,
  }
}

/**
 * Stockfish-tag every ply (both colors) for the visual analysis report.
 */
export async function analyzeGamePlies(
  plies: ReviewPly[],
  history: HistoryItem[],
  finalFen: string,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ReviewPly[]> {
  const total = plies.length
  let done = 0
  const out: ReviewPly[] = []

  for (let i = 0; i < plies.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const ply = plies[i]
    const item = history[i]
    const side = ply.color

    const before = await evalFen(ply.fen, signal)
    const next = history[i + 1]
    const afterFen = next
      ? boardToFen(next.board, next.piece.color, history.slice(0, i + 1))
      : finalFen
    const after = await evalFen(afterFen, signal)

    done += 1
    onProgress(done, total)

    if (!before || !after) {
      out.push(ply)
      continue
    }

    const uci = playedUci(item)
    const playedBest = uci === before.uci
    const scoreBefore = sideScore(before, side)
    const scoreAfter = sideScore(after, side)
    const lossCp =
      scoreBefore != null && scoreAfter != null
        ? Math.max(0, scoreBefore - scoreAfter)
        : 0
    const missedMate =
      before.whiteMate != null &&
      (side === 'white' ? before.whiteMate > 0 : before.whiteMate < 0) &&
      after.whiteMate !== before.whiteMate

    const tag = playedBest
      ? i < THEORY_PLY_CAP
        ? 'theory'
        : 'best'
      : tagFromLossCp(lossCp, missedMate, i)

    out.push({
      ...ply,
      tag,
      lossCp,
      evalPawns: evalToPawns(after) ?? undefined,
      playedEval: after.evalLabel,
      bestSan: sanForUci(ply.fen, before.uci),
      bestEval: before.evalLabel,
    })
  }

  return out
}

/**
 * Stockfish-tag player plies only (for coach API). Opponent rows keep SAN/FEN.
 * @deprecated Prefer analyzeGamePlies for the visual report; kept for coach payload mapping.
 */
export async function analyzePlayerPlies(
  plies: ReviewPly[],
  history: HistoryItem[],
  playerColor: Color,
  finalFen: string,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ReviewPly[]> {
  const all = await analyzeGamePlies(
    plies,
    history,
    finalFen,
    (done, total) => {
      // Remap progress to player-only count for HUD compatibility when needed
      onProgress(done, total)
    },
    signal,
  )
  return all.map((p) =>
    p.by === 'player'
      ? p
      : {
          ply: p.ply,
          fen: p.fen,
          san: p.san,
          by: p.by,
          color: p.color,
        },
  )
}

/** Map full report plies to coach API shape (collapse tags). */
export function pliesForCoachApi(plies: ReviewPly[]): Array<{
  ply: number
  fen: string
  san: string
  by: 'player' | 'opponent'
  tag?: CoachMoveQualityTag
  playedEval?: string
  bestSan?: string
  bestEval?: string
}> {
  return plies.map((p) => ({
    ply: p.ply,
    fen: p.fen,
    san: p.san,
    by: p.by,
    tag: p.by === 'player' ? toCoachTag(p.tag) : undefined,
    playedEval: p.by === 'player' ? p.playedEval : undefined,
    bestSan: p.by === 'player' ? p.bestSan : undefined,
    bestEval: p.by === 'player' ? p.bestEval : undefined,
  }))
}

/** Compact review text for analysis-report coach chat. */
export function formatReviewBriefForCoach(report: AnalysisReport): string {
  const you = report.playerColor === 'white' ? 'White' : 'Black'
  const wAcc =
    report.summary.whiteAccuracy != null
      ? `${report.summary.whiteAccuracy}%`
      : 'n/a'
  const bAcc =
    report.summary.blackAccuracy != null
      ? `${report.summary.blackAccuracy}%`
      : 'n/a'
  const notable = report.plies
    .filter(
      (p) =>
        p.by === 'player' &&
        p.tag &&
        (p.tag === 'best' ||
          p.tag === 'inaccuracy' ||
          p.tag === 'mistake' ||
          p.tag === 'blunder'),
    )
    .slice(0, 20)
    .map((p) => {
      const alt = p.bestSan ? ` (engine ${p.bestSan})` : ''
      return `Ply ${p.ply}: YOU ${p.san} [${p.tag}]${alt}`
    })

  return [
    `You played as ${you}.`,
    `Players: ${report.whiteName ?? 'White'} vs ${report.blackName ?? 'Black'}.`,
    `Accuracy — White ${wAcc}, Black ${bAcc}.`,
    notable.length
      ? `Notable player moves:\n${notable.join('\n')}`
      : 'No tagged player moves to highlight.',
  ].join('\n')
}
