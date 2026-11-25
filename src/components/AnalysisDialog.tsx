import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FC,
} from 'react'
import { PixelButton } from '@/components/ui/PixelButton'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pause,
  Pencil,
  Play,
  SkipBack,
  SkipForward,
} from 'lucide-react'
import { PanelResizeHandle } from '@/components/PanelResizeHandle'
import { CoachResizeHandle } from '@/components/CoachResizeHandle'
import { EditBoardDialog } from '@/components/EditBoardDialog'
import {
  CoachPane,
  type CoachChatMessage,
} from '@/components/CoachPane'
import {
  REPORT_TAG_ORDER,
  TAG_LABEL,
  TAG_RULE,
  type AnalysisReport,
  type EvalSeriesPoint,
  type MoveQualityTag,
  type ReviewPly,
} from '@/lib/gameReview'
import { Chess } from 'chess.js'
import { START_FEN } from '@/lib/fenBridge'
import { ExploreOpenings } from '@/components/ExploreOpenings'
import {
  allRatingBands,
  blackWinRate,
  explorerGames,
  fetchLichessExplorer,
  whiteWinRate,
  type ExplorerMove,
} from '@/lib/lichessExplorer'
import {
  advisedEngineMove,
  bestExplorerEngineMove,
  rankExplorerEngineMoves,
  sideEngineLabel,
  worstWhiteExplorerMove,
} from '@/lib/explorerEngineMove'
import { engineFillLines } from '@/lib/engineFill'
import { pickGraphDots } from '@/lib/evalGraphDots'
import {
  explorerMoveMarks,
  MOVE_MARK_GLYPH,
  MOVE_MARK_HINT,
  type MoveMark,
} from '@/lib/explorerMoveMarks'
import { loadExplorerRatings, loadExplorerSpeeds } from '@/lib/explorerFilterPrefs'
import {
  evalGraphHalfRange,
  evalGraphY,
  seriesPawnValue,
} from '@/lib/evalGraphScale'
import {
  loadReviewCoachFraction,
  saveReviewCoachFraction,
} from '@/lib/coachHeight'

type TabId = 'explore' | 'games'

type Props = {
  open: boolean
  onClose: () => void
  report: AnalysisReport | null
  scrubIndex: number
  onScrubTo: (index: number) => void
  analyzing?: boolean
  analyzeProgress?: string | null
  analyzeError?: string | null
  coachExplanation?: string | null
  coachStatus?: 'idle' | 'loading' | 'error'
  coachError?: string | null
  coachChat?: CoachChatMessage[]
  coachChatStatus?: 'idle' | 'loading' | 'error'
  coachChatError?: string | null
  onSendCoachChat?: (question: string) => void
  /** Unsent coach question, shared with Drill. */
  coachDraft?: string
  onCoachDraftChange?: (value: string) => void
  chessComUsername: string
  onChessComUsernameChange: (username: string) => void
  importDraft: string
  onImportDraftChange: (value: string) => void
  onImportGame: () => void
  importBusy?: boolean
  importError?: string | null
  importStatus?: string | null
  onReviewCurrent?: () => void
  canReviewCurrent?: boolean
  panelWidth: number
  onPanelWidthChange: (width: number) => void
  onPanelResizeEnd?: (width: number) => void
  /** Hover in the move table. `null` puts the played move back. */
  onPreviewMove?: (move: { fen: string; san: string } | null) => void
  onPlaySan?: (sans: string[], play?: string) => void
  playedSans?: string[]
  /** Saved explorer-engine best UCI. Explore puts a ★ on that move. */
  recommendedUci?: string | null
  /** White's worst saved score. Explore puts a ✕ on that move. */
  worstUci?: string | null
  linePly?: number
  lineLength?: number
  onLineStep?: (index: number) => void
  tab?: TabId
  onTabChange?: (tab: TabId) => void
  pgn?: string
  /** Apply an edited position to the main board. */
  onApplyFen?: (fen: string) => void
  /** Side at the bottom of the board. Explorer stats follow this seat. */
  perspective?: 'white' | 'black'
}


async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Insecure pages (a LAN http URL) reject the async clipboard API.
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.left = '-9999px'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  return ok
}

function TagGlyph({ tag }: { tag: MoveQualityTag }) {
  const symbol =
    tag === 'best'
      ? '★'
      : tag === 'excellent'
        ? '+'
        : tag === 'okay'
          ? '✓'
          : tag === 'inaccuracy'
            ? '?!'
            : tag === 'mistake'
              ? '?'
              : tag === 'blunder'
                ? '??'
                : 'T'
  return (
    <span className={`analysis-tag is-${tag}`} title={TAG_LABEL[tag]}>
      {symbol}
    </span>
  )
}

function formatGraphEval(label: string | undefined, pawns: number) {
  if (label === '#') return '#'
  if (label && /m/i.test(label)) {
    return label.startsWith('-') || label.startsWith('+') ? label : `+${label}`
  }
  const n = label != null && label !== '—' ? Number(label) : pawns
  if (!Number.isFinite(n)) return '0.00'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}`
}

export function EvalGraph({
  series,
  scrubIndex,
  onScrubTo,
  whiteName,
  blackName,
  whiteAccuracy,
  blackAccuracy,
}: {
  series: EvalSeriesPoint[]
  scrubIndex: number
  onScrubTo: (index: number) => void
  whiteName: string
  blackName: string
  whiteAccuracy: number | null
  blackAccuracy: number | null
}) {
  const [hoverPly, setHoverPly] = useState<number | null>(null)
  const w = 320
  // A little taller than the old strip so dots and the curve breathe.
  const h = 76
  // No side padding: the filled area runs edge to edge like the review graph.
  const padX = 0
  const padY = 8
  if (series.length === 0) {
    return <div className="analysis-graph is-empty">No eval data yet</div>
  }

  const points = [{ ply: 0, pawns: 0, label: '0.00' }, ...series]
  const plotH = h - padY * 2
  // Plot the tooltip's number (the label), not a value chopped at ±5.
  const plotted = points.map((s) => seriesPawnValue(s))
  const halfRange = evalGraphHalfRange(plotted)
  const pts = points.map((s, i) => {
    const x = padX + (i / Math.max(1, points.length - 1)) * (w - padX * 2)
    const y = evalGraphY(plotted[i], halfRange, padY, plotH)
    return { ...s, x, y }
  })
  const d = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ')
  const midY = h / 2
  // One filled area under the curve, like the chess.com review graph: the
  // white mass is White's share of the game, the dark plate above it is
  // Black's. A high curve means White is better, a low curve means Black is.
  const areaD = [
    `M${pts[0].x.toFixed(1)},${h}`,
    ...pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `L${pts[pts.length - 1].x.toFixed(1)},${h}`,
    'Z',
  ].join(' ')
  // Dots mark the moves that changed the game, the way the review graph does.
  // The swing is what the mover gained, so a save reads the same for either side.
  const dotCandidates = pts.slice(1).map((p, i) => {
    const before = plotted[i]
    const after = plotted[i + 1]
    return {
      ply: p.ply,
      // `x` is 0-1 for spacing rules, `at` is the SVG coordinate to draw at.
      x: (p.x - padX) / Math.max(1, w - padX * 2),
      at: p.x,
      tag: (p.tag ?? 'okay') as MoveQualityTag,
      swing: p.color === 'black' ? before - after : after - before,
      mate: p.label === '#',
      san: p.san,
      moveNo: p.moveNo,
      color: p.color,
      y: p.y,
    }
  })
  const dots = pickGraphDots(dotCandidates)
  const focus =
    pts.find((p) => p.ply === (hoverPly ?? scrubIndex)) ??
    pts[pts.length - 1]

  function plyAt(clientX: number, target: SVGSVGElement) {
    const rect = target.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * w
    let best = pts[0]
    let bestDist = Infinity
    for (const p of pts) {
      const dist = Math.abs(p.x - x)
      if (dist < bestDist) {
        bestDist = dist
        best = p
      }
    }
    return best
  }

  const leftPct = (focus.x / w) * 100
  const tipShift =
    leftPct < 14 ? '0' : leftPct > 86 ? '-100%' : '-50%'
  const tipAbove = focus.y > h * 0.32

  return (
    <div className="analysis-graph-wrap">
      <div className="analysis-graph-players">
        <span className="analysis-graph-player is-black" title={blackName}>
          <span className="analysis-graph-chip" aria-hidden="true" />
          <span className="analysis-graph-name-text">{blackName}</span>
          <span className="analysis-graph-acc">
            {blackAccuracy != null ? `${blackAccuracy}%` : 'N/A'}
          </span>
        </span>
        <span className="analysis-graph-player is-white" title={whiteName}>
          <span className="analysis-graph-chip" aria-hidden="true" />
          <span className="analysis-graph-name-text">{whiteName}</span>
          <span className="analysis-graph-acc">
            {whiteAccuracy != null ? `${whiteAccuracy}%` : 'N/A'}
          </span>
        </span>
      </div>
      <svg
        className="analysis-graph"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Engine evaluation, white above the line and black below"
        onClick={(e) => onScrubTo(plyAt(e.clientX, e.currentTarget).ply)}
        onPointerMove={(e) => setHoverPly(plyAt(e.clientX, e.currentTarget).ply)}
        onPointerLeave={() => setHoverPly(null)}
      >
        <defs>
          <clipPath id="analysis-graph-clip">
            <rect width={w} height={h} rx="8" ry="8" />
          </clipPath>
        </defs>
        <g clipPath="url(#analysis-graph-clip)">
          <rect width={w} height={h} className="analysis-graph-plate" />
          <path d={areaD} className="analysis-graph-area-white" />
          <line
            x1="0"
            x2={w}
            y1={midY}
            y2={midY}
            className="analysis-graph-zero"
          />
          <path d={d} className="analysis-graph-line" fill="none" />
          {dots.map((dot) => (
            <circle
              key={dot.ply}
              cx={dot.at.toFixed(1)}
              cy={dot.y.toFixed(1)}
              r="3"
              className={`analysis-graph-dot is-${dot.tag}`}
            >
              <title>
                {`${dot.moveNo ?? '?'}${dot.color === 'black' ? '...' : '.'} ${dot.san ?? ''} - ${TAG_LABEL[dot.tag]}`}
              </title>
            </circle>
          ))}
          <line
            x1={focus.x}
            x2={focus.x}
            y1="0"
            y2={focus.y}
            className="analysis-graph-cursor"
          />
        </g>
      </svg>
      <div
        className={
          tipAbove ? 'analysis-graph-tip' : 'analysis-graph-tip is-below'
        }
        style={{
          left: `${leftPct}%`,
          top: `${(focus.y / h) * 100}%`,
          transform: tipAbove
            ? `translate(${tipShift}, calc(-100% - 10px))`
            : `translate(${tipShift}, 12px)`,
        }}
      >
        {formatGraphEval(focus.label, focus.pawns)}
      </div>
    </div>
  )
}

const TOP_ENGINE_MOVES = 5

type ChoiceRow = {
  san: string
  pct: number | null
  games: number | null
  engine: boolean
  /** Side-to-move eval. Plus is good for the side about to play. */
  engineLabel: string | null
  engineTip: string | null
  marks: MoveMark[]
}

function sanKey(san: string) {
  return san.replace(/[+#]$/, '')
}

function sanForUci(fen: string, uci: string): string | null {
  if (uci.length < 4) return null
  try {
    const chess = new Chess(fen)
    const played = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || undefined,
    })
    return played?.san ?? null
  } catch {
    return null
  }
}

function savedEngineTip(depth: number | null): string {
  return depth !== null && depth > 0 ? `Depth ${depth}` : 'Saved engine score'
}

/**
 * Engine score of the move that was actually played, from the mover's side.
 * Every other row in the table is scored for the side to move, so the played
 * row has to match or it looks like the engine had nothing to say about it.
 */
function playedRowEngineLabel(ply: ReviewPly): string | null {
  const label = ply.playedEval?.trim()
  if (label === '#') return '#'
  const mate = label?.match(/^(-)?M(\d+)$/i)
  if (mate) {
    const forWhite = mate[1] ? -Number(mate[2]) : Number(mate[2])
    const shown = ply.color === 'white' ? forWhite : -forWhite
    return shown > 0 ? `+M${shown}` : `-M${Math.abs(shown)}`
  }
  const pawns = ply.evalPawns
  if (pawns == null || !Number.isFinite(pawns)) return null
  const shown = ply.color === 'white' ? pawns : -pawns
  const text = Math.abs(shown).toFixed(2)
  if (shown > 0) return `+${text}`
  if (shown < 0) return `-${text}`
  return '0.00'
}

/**
 * Give the played row the same engine score column as the other rows.
 * The explorer detail and the engine fill both leave it blank, which made the
 * top row look like the engine had no opinion on the move that was played.
 */
function withPlayedRowEval(rows: ChoiceRow[], ply: ReviewPly): ChoiceRow[] {
  const label = playedRowEngineLabel(ply)
  if (!label) return rows
  const key = sanKey(ply.san)
  return rows.map((row) =>
    sanKey(row.san) === key && !row.engineLabel
      ? {
          ...row,
          engineLabel: label,
          engineTip: 'Stockfish score after the move you played',
        }
      : row,
  )
}

/** Top explorer-engine rows for this ply, plus the played move when it missed the cut. */
function choiceRowsForPly(
  moves: readonly ExplorerMove[],
  side: 'white' | 'black',
  playedSan: string,
  playedEngineLabel: string | null,
): ChoiceRow[] {
  const rate = side === 'black' ? blackWinRate : whiteWinRate
  const ranked = rankExplorerEngineMoves(moves, side, {
    limit: TOP_ENGINE_MOVES,
    playedSan,
  })
  const best = bestExplorerEngineMove(moves, side)
  const worst = worstWhiteExplorerMove(moves, side)
  const marks = explorerMoveMarks({
    rows: moves.map((move) => ({
      id: move.uci,
      san: move.san,
      kind: 'opening',
      path: [move.san],
      play: move.uci,
      games: explorerGames(move),
      winRate: whiteWinRate(move),
    })),
    playedSans: [],
    recommendedUci: best?.uci ?? null,
    worstUci: worst?.uci ?? null,
    shownWin: (row) => {
      if (row.winRate < 0) return null
      const value = Number((row.winRate * 100).toFixed(1))
      return Number.isFinite(value) ? value : null
    },
  })
  const playedKey = sanKey(playedSan)
  const rows: ChoiceRow[] = ranked.map((item, index) => {
    const games = explorerGames(item.move)
    const scored = item.score !== null
    const engine = index === 0 && scored
    return {
      san: item.move.san,
      pct: games > 0 ? Math.round(rate(item.move) * 100) : null,
      games: games > 0 ? games : null,
      engine,
      engineLabel: item.label,
      engineTip: item.label ? savedEngineTip(item.move.engineDepth) : null,
      marks: marks.get(item.move.uci) ?? [],
    }
  })
  if (playedSan && !rows.some((row) => sanKey(row.san) === playedKey)) {
    rows.push({
      san: playedSan,
      pct: null,
      games: null,
      engine: false,
      engineLabel: playedEngineLabel,
      engineTip: playedEngineLabel
        ? 'Stockfish score after the move you played'
        : null,
      marks: [],
    })
  }
  return rows
}

function MoveChoices({
  ply,
  onPreviewMove,
}: {
  ply: ReviewPly
  onPreviewMove?: (move: { fen: string; san: string } | null) => void
}) {
  const [rows, setRows] = useState<ChoiceRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const previewRef = useRef(onPreviewMove)
  previewRef.current = onPreviewMove

  useEffect(() => () => previewRef.current?.(null), [ply.ply])

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    setRows([])
    const ratings = loadExplorerRatings()
    const speeds = loadExplorerSpeeds()
    const side = ply.color === 'black' ? 'black' : 'white'

    // Sparse opener positions: fill the detail from Stockfish MultiPV.
    const fillFromEngine = async (base: ChoiceRow[]): Promise<ChoiceRow[]> => {
      if (base.length >= 5) return base
      try {
        const lines = await engineFillLines(ply.fen, controller.signal)
        const seen = new Set(base.map((row) => sanKey(row.san)))
        const extra: ChoiceRow[] = []
        for (const line of lines) {
          if (base.length + extra.length >= 5) break
          const san = sanForUci(ply.fen, line.uci)
          if (!san || seen.has(sanKey(san))) continue
          extra.push({
            san,
            pct: null,
            games: null,
            engine: true,
            engineLabel: sideEngineLabel(
              { engineCp: line.whiteCp, engineMate: line.whiteMate },
              side,
            ),
            engineTip: line.depth > 0 ? `Depth ${line.depth}` : 'Engine score',
            marks: extra.length === 0 ? ['best'] : [],
          })
        }
        return [...base, ...extra]
      } catch {
        return base
      }
    }

    void fetchLichessExplorer(
      ply.fen,
      ratings.length > 0 ? ratings : allRatingBands(),
      controller.signal,
      { speeds },
    )
      .then(async (position) => {
        const base = withPlayedRowEval(
          choiceRowsForPly(
            position.moves,
            side,
            ply.san,
            playedRowEngineLabel(ply),
          ),
          ply,
        )
        setRows(base)
        setStatus('ready')
        const filled = await fillFromEngine(base)
        if (!controller.signal.aborted) setRows(withPlayedRowEval(filled, ply))
      })
      .catch(async (err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setStatus('error')
        const advised = advisedEngineMove(null, ply.bestSan)
        const base: ChoiceRow[] = advised
          ? [
              {
                san: advised.san,
                pct: null,
                games: null,
                engine: true,
                engineLabel: null,
                engineTip: null,
                marks: [],
              },
            ]
          : []
        setRows(withPlayedRowEval(base, ply))
        const filled = await fillFromEngine(base)
        if (!controller.signal.aborted) setRows(withPlayedRowEval(filled, ply))
      })
    return () => controller.abort()
  }, [ply.bestSan, ply.color, ply.fen, ply.san])

  return (
    <div
      className="analysis-move-detail"
      onMouseLeave={() => previewRef.current?.(null)}
    >
      {status === 'loading' && rows.length === 0 ? (
        <p className="analysis-move-detail-meta">Looking up games…</p>
      ) : null}
      {status === 'error' && rows.length === 0 ? (
        <p className="analysis-move-detail-meta">Couldn’t read the explorer.</p>
      ) : null}
      {status === 'ready' && rows.length === 0 ? (
        <p className="analysis-move-detail-meta">No games in this position.</p>
      ) : null}
      {rows.length > 0 ? (
        <table className="analysis-move-table">
          <thead>
            <tr>
              <th>Move</th>
              <th>Win %</th>
              <th>Games</th>
              <th>Engine</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const played = sanKey(row.san) === sanKey(ply.san)
              return (
                <tr
                  key={row.san}
                  className={[
                    row.engine ? 'is-engine' : '',
                    played ? 'is-played' : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined}
                  onMouseEnter={() =>
                    previewRef.current?.({ fen: ply.fen, san: row.san })
                  }
                >
                <td>
                  <span className="analysis-move-table-name">
                    <span>{row.san}</span>
                    {row.marks.length > 0 ? (
                      <span className="explorer-move-icons" data-marks={row.marks.join(' ')}>
                        {row.marks.map((mark) => (
                          <span
                            key={mark}
                            className="explorer-move-icon"
                            role="img"
                            aria-label={MOVE_MARK_HINT[mark]}
                            title={MOVE_MARK_HINT[mark]}
                          >
                            {MOVE_MARK_GLYPH[mark]}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {played ? (
                      <span className="analysis-move-table-tag is-played">played</span>
                    ) : null}
                  </span>
                </td>
                <td>{row.pct != null ? `${row.pct}%` : '—'}</td>
                <td>{row.games != null ? row.games.toLocaleString() : '—'}</td>
                <td title={row.engineTip ?? undefined}>{row.engineLabel ?? '—'}</td>
              </tr>
              )
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

type CommonReply = {
  san: string
  uci: string
  share: number
  win: number
  games: number
}

/** Position on the board at `scrubIndex`, plus who is to move. */
function positionForReplies(
  report: AnalysisReport,
  scrubIndex: number,
): { fen: string; color: ReviewPly['color'] } | null {
  const plies = report.plies
  if (scrubIndex >= 0 && scrubIndex < plies.length) {
    return { fen: plies[scrubIndex].fen, color: plies[scrubIndex].color }
  }
  if (plies.length === 0) return { fen: START_FEN, color: 'white' }
  const last = plies[plies.length - 1]
  try {
    const chess = new Chess(last.fen)
    if (!chess.move(last.san)) return null
    return {
      fen: chess.fen(),
      color: last.color === 'white' ? 'black' : 'white',
    }
  } catch {
    return null
  }
}

function groupMoves(plies: ReviewPly[]) {
  const rows: Array<{
    moveNo: number
    white?: ReviewPly
    black?: ReviewPly
  }> = []
  for (const ply of plies) {
    const moveNo = Math.ceil(ply.ply / 2)
    let row = rows.find((r) => r.moveNo === moveNo)
    if (!row) {
      row = { moveNo }
      rows.push(row)
    }
    if (ply.color === 'white') row.white = ply
    else row.black = ply
  }
  return rows
}

export const AnalysisDialog: FC<Props> = ({
  open,
  onClose,
  report,
  scrubIndex,
  onScrubTo,
  analyzing = false,
  analyzeProgress = null,
  analyzeError = null,
  coachExplanation = null,
  coachStatus = 'idle',
  coachError = null,
  coachChat = [],
  coachChatStatus = 'idle',
  coachChatError = null,
  onSendCoachChat,
  coachDraft,
  onCoachDraftChange,
  chessComUsername,
  onChessComUsernameChange,
  importDraft,
  onImportDraftChange,
  onImportGame,
  importBusy = false,
  importError = null,
  importStatus = null,
  onReviewCurrent,
  canReviewCurrent = false,
  panelWidth,
  onPanelWidthChange,
  onPanelResizeEnd,
  onPreviewMove,
  onPlaySan,
  playedSans = [],
  recommendedUci = null,
  worstUci = null,
  linePly = 0,
  lineLength = 0,
  onLineStep,
  tab: tabProp,
  onTabChange,
  pgn = '',
  onApplyFen,
  perspective = 'white',
}) => {
  const [tabState, setTabState] = useState<TabId>(() =>
    new URLSearchParams(window.location.search).get('panel') === 'my-games'
      ? 'games'
      : 'explore',
  )
  const tab = tabProp ?? tabState
  function selectTab(next: TabId) {
    setTabState(next)
    onTabChange?.(next)
  }
  const [importOpen, setImportOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const importWasBusy = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [pgnCopied, setPgnCopied] = useState(false)
  useEffect(() => {
    if (!pgnCopied) return
    const id = window.setTimeout(() => setPgnCopied(false), 1600)
    return () => window.clearTimeout(id)
  }, [pgnCopied])
  const [reviewCoachFraction, setReviewCoachFraction] = useState(
    loadReviewCoachFraction,
  )
  const reviewReportRef = useRef<HTMLDivElement>(null)
  const exploreCoachRef = useRef<HTMLDivElement>(null)
  const onScrubToRef = useRef(onScrubTo)
  onScrubToRef.current = onScrubTo
  const moveRows = useMemo(
    () => (report ? groupMoves(report.plies) : []),
    [report],
  )
  const maxPly = report?.plies.length ?? 0
  const whiteLabel = report?.whiteName ?? 'White'
  const blackLabel = report?.blackName ?? 'Black'
  const [expandedPly, setExpandedPly] = useState<number | null>(null)
  const replyPosition = useMemo(
    () => (report ? positionForReplies(report, scrubIndex) : null),
    [report, scrubIndex],
  )
  const reviewFen = replyPosition?.fen ?? START_FEN
  const playedNext =
    report && scrubIndex < report.plies.length
      ? report.plies[scrubIndex].san
      : null
  const [common, setCommon] = useState<{
    fen: string
    moves: CommonReply[]
  } | null>(null)
  const [commonStatus, setCommonStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle',
  )
  const [commonError, setCommonError] = useState<string | null>(null)
  const coachQuestionCount = useMemo(
    () => coachChat.filter((message) => message.role === 'user').length,
    [coachChat],
  )

  // A fresh review starts from the saved coach height. Dragging the handle
  // updates the live fraction without this effect fighting it.
  useEffect(() => {
    if (coachQuestionCount === 0) {
      setReviewCoachFraction(loadReviewCoachFraction())
    }
  }, [coachQuestionCount])

  useEffect(() => {
    if (!open || !report) return
    selectTab('games')
    // Switch to My Games when a review report arrives. Tab clicks are separate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, report])

  useEffect(() => {
    if (importWasBusy.current && !importBusy && !importError) {
      setImportOpen(false)
    }
    importWasBusy.current = Boolean(importBusy)
  }, [importBusy, importError])

  const transportIndex = report ? scrubIndex : linePly
  const transportMax = report ? maxPly : lineLength
  const onLineStepRef = useRef(onLineStep)
  onLineStepRef.current = onLineStep
  const stepTransport = (index: number) => {
    setPlaying(false)
    if (report) onScrubTo(index)
    else onLineStepRef.current?.(index)
  }

  useEffect(() => {
    if (!open || !playing) return
    if (!report && lineLength <= 0) return
    if (transportIndex >= transportMax) {
      setPlaying(false)
      return
    }
    const id = window.setTimeout(() => {
      const next = Math.min(transportMax, transportIndex + 1)
      if (report) onScrubToRef.current(next)
      else onLineStepRef.current?.(next)
    }, 650)
    return () => window.clearTimeout(id)
  }, [open, playing, report, transportIndex, transportMax, lineLength])

  useEffect(() => {
    if (!open) setPlaying(false)
  }, [open])

  useEffect(() => {
    if (!open || tab !== 'games' || !replyPosition) return
    const controller = new AbortController()
    const fen = replyPosition.fen
    const color = replyPosition.color
    setCommonStatus('loading')
    setCommonError(null)
    const timer = window.setTimeout(() => {
      const ratings = loadExplorerRatings()
      const speeds = loadExplorerSpeeds()
      void fetchLichessExplorer(
        fen,
        ratings.length > 0 ? ratings : allRatingBands(),
        controller.signal,
        { speeds },
      )
        .then((position) => {
          if (controller.signal.aborted) return
          const total = position.white + position.draws + position.black
          const rate = color === 'black' ? blackWinRate : whiteWinRate
          const moves = [...position.moves]
            .map((move) => {
              const games = explorerGames(move)
              return {
                san: move.san,
                uci: move.uci,
                games,
                share: total > 0 ? Math.round((100 * games) / total) : 0,
                win: games > 0 ? Math.round(rate(move) * 100) : 0,
              }
            })
            .filter((move) => move.games > 0)
            .sort((a, b) => b.games - a.games || a.san.localeCompare(b.san))
            .slice(0, 8)
          setCommon({ fen, moves })
          setCommonStatus('idle')
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setCommonStatus('error')
          setCommonError(
            err instanceof Error ? err.message : 'Couldn’t read the explorer.',
          )
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, tab, replyPosition])

  return (
    <div
      className={['analysis-backdrop', open ? '' : 'is-closed']
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      aria-hidden={!open}
    >
      <aside
        className="analysis-dialog"
        role="dialog"
        aria-label="Analysis"
        inert={!open ? true : undefined}
      >
        <PanelResizeHandle
          width={panelWidth}
          onWidthChange={onPanelWidthChange}
          onResizeEnd={onPanelResizeEnd}
        />
        <header className="analysis-dialog-header">
          <div className="analysis-dialog-title">
            <h2>Analysis</h2>
          </div>
          <div className="analysis-dialog-actions">
            {tab === 'games' ? (
              <PixelButton onClick={() => setImportOpen(true)}>
                Import
              </PixelButton>
            ) : null}
            <PixelButton ghost onClick={onClose}>
              Close
            </PixelButton>
          </div>
        </header>

        <div className="analysis-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'explore'}
            className={tab === 'explore' ? 'is-active' : ''}
            onClick={() => selectTab('explore')}
          >
            Explore
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'games'}
            className={tab === 'games' ? 'is-active' : ''}
            onClick={() => selectTab('games')}
          >
            My Games
          </button>
        </div>

        <div className="analysis-dialog-body">
          {tab === 'explore' && open ? (
            <div
              className="explore-with-coach"
              ref={exploreCoachRef}
              style={
                {
                  '--review-coach-fraction': reviewCoachFraction,
                } as CSSProperties
              }
            >
              <ExploreOpenings
                onPlaySan={onPlaySan}
                playedSans={playedSans}
                recommendedUci={recommendedUci}
                worstUci={worstUci}
                perspective={perspective}
              />
              {onSendCoachChat ? (
                <>
                  <CoachResizeHandle
                    fraction={reviewCoachFraction}
                    containerRef={exploreCoachRef}
                    onFractionChange={setReviewCoachFraction}
                    onCommit={saveReviewCoachFraction}
                  />
                  <div className="drill-coach-embed">
                    <CoachPane
                      explanation={coachExplanation}
                      coachStatus={coachStatus}
                      coachError={coachError}
                      chatMessages={coachChat}
                      chatStatus={coachChatStatus}
                      chatError={coachChatError}
                      onSendChat={onSendCoachChat}
                      isPlayerTurn
                      drillMode
                      emptyHint=""
                      draft={coachDraft}
                      onDraftChange={onCoachDraftChange}
                    />
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {analyzing && tab === 'games' && (
            <p className="analysis-status">{analyzeProgress ?? 'Analyzing…'}</p>
          )}

          {!analyzing && analyzeError && tab === 'games' && (
            <p className="analysis-status is-error">{analyzeError}</p>
          )}

          {!analyzing && !report && !analyzeError && tab === 'games' && (
            <p className="analysis-status">
              Import a game or finish a match, then run review to see My Games.
            </p>
          )}

          {report && tab === 'games' && (
            <div
              className="analysis-report"
              ref={reviewReportRef}
              style={
                {
                  '--review-coach-fraction': reviewCoachFraction,
                } as CSSProperties
              }
            >
              <div className="analysis-report-scroll">
                <EvalGraph
                  series={report.summary.evalSeries}
                  scrubIndex={scrubIndex}
                  onScrubTo={onScrubTo}
                  whiteName={whiteLabel}
                  blackName={blackLabel}
                  whiteAccuracy={report.summary.whiteAccuracy}
                  blackAccuracy={report.summary.blackAccuracy}
                />

                <section className="analysis-counts" aria-label="My Games">
                  <h3>My Games</h3>
                  <div className="analysis-counts-head">
                    <span />
                    <span title={whiteLabel}>{whiteLabel}</span>
                    <span title={blackLabel}>{blackLabel}</span>
                  </div>
                  {REPORT_TAG_ORDER.map((tag) => (
                    <div
                      key={tag}
                      className="analysis-counts-row"
                      title={TAG_RULE[tag]}
                    >
                      <span className="analysis-counts-label">
                        <TagGlyph tag={tag} />
                        {TAG_LABEL[tag]}
                      </span>
                      <span>{report.summary.whiteCounts[tag]}</span>
                      <span>{report.summary.blackCounts[tag]}</span>
                    </div>
                  ))}
                </section>

                <ul className="analysis-move-list">
                  {moveRows.map((row) => {
                    const openPly =
                      expandedPly === row.white?.ply
                        ? row.white
                        : expandedPly === row.black?.ply
                          ? row.black
                          : null
                    const moveButton = (ply: ReviewPly) => (
                      <button
                        type="button"
                        className={[
                          'analysis-move-san',
                          scrubIndex === ply.ply ? 'is-active' : '',
                          expandedPly === ply.ply ? 'is-open' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-expanded={expandedPly === ply.ply}
                        onClick={() => {
                          onScrubTo(ply.ply)
                          setExpandedPly((current) =>
                            current === ply.ply ? null : ply.ply,
                          )
                        }}
                      >
                        {ply.tag && <TagGlyph tag={ply.tag} />}
                        <span>{ply.san}</span>
                        {ply.stats ? (
                          <span
                            className="analysis-move-win"
                            title={`Opener: played ${(ply.stats.playRate * 100).toFixed(1)}% of ${ply.stats.games} games · wins ${(ply.stats.winRate * 100).toFixed(1)}%`}
                          >
                            {(ply.stats.winRate * 100).toFixed(0)}%
                          </span>
                        ) : null}
                        {ply.bestSan && (
                          <span
                            className={[
                              'analysis-move-engine',
                              ply.bestSan !== ply.san ? 'is-alt' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            title="Engine best move"
                          >
                            {ply.bestSan}
                          </span>
                        )}
                      </button>
                    )
                    return (
                      <li key={row.moveNo} className="analysis-move-row">
                        <span className="analysis-move-no">{row.moveNo}.</span>
                        {row.white ? (
                          moveButton(row.white)
                        ) : (
                          <span className="analysis-move-san is-empty">…</span>
                        )}
                        {row.black ? (
                          moveButton(row.black)
                        ) : (
                          <span className="analysis-move-san is-empty" />
                        )}
                        {openPly ? (
                          <MoveChoices ply={openPly} onPreviewMove={onPreviewMove} />
                        ) : null}
                      </li>
                    )
                  })}
                </ul>

                <section className="analysis-replies" aria-label="Common next moves">
                  <p className="analysis-replies-label">Common next moves</p>
                  {commonStatus === 'loading' &&
                  (!common || common.fen !== replyPosition?.fen) ? (
                    <p className="analysis-replies-note">Looking up games…</p>
                  ) : null}
                  {commonStatus === 'error' ? (
                    <p className="analysis-replies-note is-error">
                      {commonError ?? 'Couldn’t read the explorer.'}
                    </p>
                  ) : null}
                  {common &&
                  common.fen === replyPosition?.fen &&
                  common.moves.length === 0 &&
                  commonStatus !== 'loading' ? (
                    <p className="analysis-replies-note">No games in this position.</p>
                  ) : null}
                  {common && common.fen === replyPosition?.fen && common.moves.length > 0 ? (
                    <ul className="analysis-reply-list">
                      {common.moves.map((move) => (
                        <li
                          key={move.san}
                          className={[
                            'analysis-reply',
                            playedNext === move.san ? 'is-played' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <span className="analysis-reply-san">{move.san}</span>
                          <span className="analysis-reply-pct">{move.share}%</span>
                          <span className="analysis-reply-meta">
                            {move.games.toLocaleString()} games · {move.win}% win
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              </div>

              {onSendCoachChat && (
                <>
                  <CoachResizeHandle
                    fraction={reviewCoachFraction}
                    containerRef={reviewReportRef}
                    onFractionChange={setReviewCoachFraction}
                    onCommit={saveReviewCoachFraction}
                  />
                  <div className="analysis-coach-embed">
                    <CoachPane
                      explanation={coachExplanation}
                      coachStatus={coachStatus}
                      coachError={coachError}
                      chatMessages={coachChat}
                      chatStatus={coachChatStatus}
                      chatError={coachChatError}
                      onSendChat={onSendCoachChat}
                      isPlayerTurn
                      reviewMode
                      emptyHint=""
                      draft={coachDraft}
                      onDraftChange={onCoachDraftChange}
                    />
                  </div>
                </>
              )}
            </div>
          )}

        </div>

        {importOpen ? (
          <div className="import-modal-backdrop" role="presentation">
            <div
              className="import-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="import-modal-title"
            >
              <div className="import-modal-head">
                <h3 id="import-modal-title">Import</h3>
                <PixelButton ghost onClick={() => setImportOpen(false)}>
                  Close
                </PixelButton>
              </div>
              <p className="analysis-import-lead">
                Enter your chess.com username to review your latest game, or paste a PGN or game link.
              </p>
              <label className="slider-label" htmlFor="analysis-chesscom-user">
                Your chess.com username
                <span className="elo-hint">(sets which side is “you”)</span>
              </label>
              <input
                id="analysis-chesscom-user"
                className="settings-select"
                type="text"
                value={chessComUsername}
                placeholder="optional"
                autoComplete="username"
                onChange={(e) => onChessComUsernameChange(e.target.value)}
                disabled={importBusy || analyzing}
              />
              <label className="slider-label" htmlFor="analysis-import-pgn">
                PGN or chess.com game link
              </label>
              <textarea
                id="analysis-import-pgn"
                className="settings-fen import-textarea"
                value={importDraft}
                onChange={(e) => onImportDraftChange(e.target.value)}
                rows={8}
                spellCheck={false}
                placeholder={
                  'https://www.chess.com/game/live/…\nor\n[Event "…"]\n1. e4 e5 …'
                }
                disabled={importBusy || analyzing}
              />
              {importStatus && (
                <p className="settings-import-status">{importStatus}</p>
              )}
              {importError && <p className="error">{importError}</p>}
              <PixelButton
                className={
                  importBusy ? 'settings-full-btn is-busy' : 'settings-full-btn'
                }
                onClick={onImportGame}
                aria-busy={importBusy}
                disabled={
                  importBusy ||
                  analyzing ||
                  (!importDraft.trim() && !chessComUsername.trim())
                }
              >
                {importBusy ? (
                  <>
                    <span className="import-spinner" aria-hidden />
                    {analyzing ? 'Analyzing…' : 'Importing…'}
                  </>
                ) : importDraft.trim() ? (
                  'Import & review'
                ) : (
                  'Review latest game'
                )}
              </PixelButton>
              {onReviewCurrent && (
                <PixelButton
                  ghost
                  className="settings-full-btn"
                  onClick={onReviewCurrent}
                  disabled={!canReviewCurrent || importBusy || analyzing}
                >
                  {analyzing ? 'Analyzing…' : 'Review current game'}
                </PixelButton>
              )}
            </div>
          </div>
        ) : null}

        <footer className="analysis-transport">
          <div className="analysis-transport-controls">
            <PixelButton
              ghost
              icon
              disabled={transportIndex <= 0}
              onClick={() => stepTransport(0)}
              aria-label="Start"
            >
              <SkipBack size={16} strokeWidth={1.75} aria-hidden="true" />
            </PixelButton>
            <PixelButton
              ghost
              icon
              disabled={transportIndex <= 0}
              onClick={() => stepTransport(transportIndex - 1)}
              aria-label="Previous"
            >
              <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            </PixelButton>
            <PixelButton
              ghost
              icon
              disabled={transportMax === 0}
              onClick={() => {
                if (transportIndex >= transportMax) stepTransport(0)
                setPlaying((p) => !p)
              }}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? (
                <Pause size={16} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Play size={16} strokeWidth={1.75} aria-hidden="true" />
              )}
            </PixelButton>
            <span className="analysis-transport-label">
              {transportIndex}/{transportMax}
            </span>
            <PixelButton
              ghost
              icon
              disabled={transportIndex >= transportMax}
              onClick={() => stepTransport(transportIndex + 1)}
              aria-label="Next"
            >
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </PixelButton>
            <PixelButton
              ghost
              icon
              disabled={transportIndex >= transportMax}
              onClick={() => stepTransport(transportMax)}
              aria-label="End"
            >
              <SkipForward size={16} strokeWidth={1.75} aria-hidden="true" />
            </PixelButton>
          </div>
          {report && onApplyFen ? (
            <PixelButton
              ghost
              icon
              aria-label="Edit board"
              title="Edit board"
              onClick={() => setEditOpen(true)}
            >
              <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
            </PixelButton>
          ) : null}
          <PixelButton
            ghost
            icon
            className="analysis-copy-pgn"
            disabled={!pgn.trim()}
            aria-label={pgnCopied ? 'PGN copied' : 'Copy PGN'}
            title={pgnCopied ? 'PGN copied' : 'Copy PGN'}
            onClick={() => {
              if (!pgn.trim()) return
              void writeClipboard(pgn).then((ok) => {
                if (ok) setPgnCopied(true)
              })
            }}
          >
            {pgnCopied ? (
              <Check size={16} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
            )}
          </PixelButton>
        </footer>

        <EditBoardDialog
          open={editOpen}
          fen={reviewFen}
          onClose={() => setEditOpen(false)}
          onApply={(fen) => {
            onApplyFen?.(fen)
            onClose()
          }}
        />
      </aside>
    </div>
  )
}
