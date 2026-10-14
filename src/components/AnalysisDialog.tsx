import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FC,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { PixelButton } from '@/components/ui/PixelButton'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from 'lucide-react'
import { PanelResizeHandle } from '@/components/PanelResizeHandle'
import {
  CoachPane,
  type CoachChatMessage,
} from '@/components/CoachPane'
import {
  REPORT_TAG_ORDER,
  TAG_LABEL,
  type AnalysisReport,
  type MoveQualityTag,
  type ReviewPly,
} from '@/lib/gameReview'
import { Chess } from 'chess.js'
import { type FrequencyArrow } from '@/lib/replyArrows'
import { START_FEN } from '@/lib/fenBridge'
import { ExploreOpenings } from '@/components/ExploreOpenings'
import {
  allRatingBands,
  blackWinRate,
  explorerGames,
  fetchLichessExplorer,
  whiteWinRate,
} from '@/lib/lichessExplorer'
import { loadExplorerRatings, loadExplorerSpeeds } from '@/lib/explorerFilterPrefs'

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
  onFrequencyArrows?: (arrows: FrequencyArrow[]) => void
  /** Hover in the move table. `null` puts the played move back. */
  onPreviewMove?: (move: { fen: string; san: string } | null) => void
  onPlaySan?: (sans: string[], play?: string) => void
  playedSans?: string[]
  linePly?: number
  lineLength?: number
  onLineStep?: (index: number) => void
  tab?: TabId
  onTabChange?: (tab: TabId) => void
  pgn?: string
}

const DEFAULT_REVIEW_COACH_FRACTION = 0.42
const EXPANDED_REVIEW_COACH_FRACTION = 2 / 3
const MIN_REVIEW_COACH_FRACTION = 0.28
const MAX_REVIEW_COACH_FRACTION = 0.8

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

function clampReviewCoachFraction(fraction: number) {
  return Math.min(
    MAX_REVIEW_COACH_FRACTION,
    Math.max(MIN_REVIEW_COACH_FRACTION, fraction),
  )
}

function ReviewCoachResizeHandle({
  fraction,
  containerRef,
  onFractionChange,
}: {
  fraction: number
  containerRef: React.RefObject<HTMLDivElement | null>
  onFractionChange: (fraction: number) => void
}) {
  const dragging = useRef(false)
  const startY = useRef(0)
  const startFraction = useRef(fraction)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true
    startY.current = event.clientY
    startFraction.current = fraction
    document.body.classList.add('is-review-coach-resizing')
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    event.preventDefault()
    const height = containerRef.current?.getBoundingClientRect().height ?? 0
    if (height <= 0) return
    const delta = startY.current - event.clientY
    onFractionChange(
      clampReviewCoachFraction(startFraction.current + delta / height),
    )
  }

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    document.body.classList.remove('is-review-coach-resizing')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const delta = event.key === 'ArrowUp' ? 0.05 : -0.05
    onFractionChange(clampReviewCoachFraction(fraction + delta))
  }

  return (
    <div
      className="analysis-coach-resize-handle"
      role="separator"
      tabIndex={0}
      aria-label="Resize coach area"
      aria-orientation="horizontal"
      aria-valuemin={Math.round(MIN_REVIEW_COACH_FRACTION * 100)}
      aria-valuemax={Math.round(MAX_REVIEW_COACH_FRACTION * 100)}
      aria-valuenow={Math.round(fraction * 100)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
      onKeyDown={onKeyDown}
    />
  )
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
  if (label && /m/i.test(label)) {
    return label.startsWith('-') || label.startsWith('+') ? label : `+${label}`
  }
  const n = label != null && label !== '—' ? Number(label) : pawns
  if (!Number.isFinite(n)) return '0.00'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}`
}

function EvalGraph({
  series,
  scrubIndex,
  onScrubTo,
  whiteName,
  blackName,
  whiteAccuracy,
  blackAccuracy,
}: {
  series: Array<{ ply: number; pawns: number; label?: string }>
  scrubIndex: number
  onScrubTo: (index: number) => void
  whiteName: string
  blackName: string
  whiteAccuracy: number | null
  blackAccuracy: number | null
}) {
  const [hoverPly, setHoverPly] = useState<number | null>(null)
  const w = 320
  const h = 66
  const padX = 8
  const padY = 8
  if (series.length === 0) {
    return <div className="analysis-graph is-empty">No eval data yet</div>
  }

  const points = [{ ply: 0, pawns: 0, label: '0.00' }, ...series]
  const plotH = h - padY * 2
  const pts = points.map((s, i) => {
    const x = padX + (i / Math.max(1, points.length - 1)) * (w - padX * 2)
    const y = padY + ((5 - s.pawns) / 10) * plotH
    return { ...s, x, y }
  })
  const d = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ')
  const midY = h / 2
  const areaToZero = (side: 'white' | 'black') => {
    const above = side === 'white'
    const parts: string[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const aOnSide = above ? a.y <= midY : a.y >= midY
      const bOnSide = above ? b.y <= midY : b.y >= midY
      if (!aOnSide && !bOnSide) continue
      let x1 = a.x
      let y1 = a.y
      let x2 = b.x
      let y2 = b.y
      if (aOnSide !== bOnSide) {
        const t = (midY - a.y) / (b.y - a.y)
        const cross = a.x + t * (b.x - a.x)
        if (aOnSide) {
          x2 = cross
          y2 = midY
        } else {
          x1 = cross
          y1 = midY
        }
      }
      parts.push(
        `M${x1.toFixed(1)},${midY.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)} L${x2.toFixed(1)},${midY.toFixed(1)} Z`,
      )
    }
    return parts.join(' ')
  }
  const whiteArea = areaToZero('white')
  const blackArea = areaToZero('black')
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
          <rect width={w} height={midY} className="analysis-graph-white" />
          <rect
            y={midY}
            width={w}
            height={h - midY}
            className="analysis-graph-black"
          />
          {whiteArea && (
            <path d={whiteArea} className="analysis-graph-area-white" />
          )}
          {blackArea && (
            <path d={blackArea} className="analysis-graph-area-black" />
          )}
          <line
            x1="0"
            x2={w}
            y1={midY}
            y2={midY}
            className="analysis-graph-zero"
          />
          <path d={d} className="analysis-graph-line" fill="none" />
          <line
            x1={focus.x}
            x2={focus.x}
            y1="0"
            y2={focus.y}
            className="analysis-graph-cursor"
          />
        </g>
      </svg>
      <span className="analysis-graph-name is-black">
        <span className="analysis-graph-name-text">{blackName}</span>
        <span className="analysis-graph-acc">
          {blackAccuracy != null ? `${blackAccuracy}%` : 'N/A'}
        </span>
      </span>
      <span className="analysis-graph-name is-white">
        <span className="analysis-graph-name-text">{whiteName}</span>
        <span className="analysis-graph-acc">
          {whiteAccuracy != null ? `${whiteAccuracy}%` : 'N/A'}
        </span>
      </span>
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

const MOVE_TABLE_CAP = 6

type ChoiceRow = {
  san: string
  pct: number | null
  games: number | null
  engine: boolean
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
    void fetchLichessExplorer(
      ply.fen,
      ratings.length > 0 ? ratings : allRatingBands(),
      controller.signal,
      { speeds },
    )
      .then((position) => {
        const rate = ply.color === 'black' ? blackWinRate : whiteWinRate
        const ranked = [...position.moves].sort(
          (a, b) => explorerGames(b) - explorerGames(a),
        )
        const next: ChoiceRow[] = []
        if (ply.bestSan) {
          const match = position.moves.find((move) => move.san === ply.bestSan)
          const games = match ? explorerGames(match) : 0
          next.push({
            san: ply.bestSan,
            pct: match && games > 0 ? Math.round(rate(match) * 100) : null,
            games: match && games > 0 ? games : null,
            engine: true,
          })
        }
        for (const move of ranked) {
          if (next.length >= MOVE_TABLE_CAP) break
          if (next.some((row) => row.san === move.san)) continue
          const games = explorerGames(move)
          if (games <= 0) continue
          next.push({
            san: move.san,
            pct: Math.round(rate(move) * 100),
            games,
            engine: false,
          })
        }
        setRows(next)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setStatus('error')
        if (ply.bestSan) {
          setRows([
            { san: ply.bestSan, pct: null, games: null, engine: true },
          ])
        }
      })
    return () => controller.abort()
  }, [ply.bestSan, ply.color, ply.fen])

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
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.san}
                className={row.san === ply.san ? 'is-played' : undefined}
                onMouseEnter={() =>
                  previewRef.current?.({ fen: ply.fen, san: row.san })
                }
              >
                <td>
                  {row.san}
                  {row.engine ? (
                    <span className="analysis-move-table-tag">engine</span>
                  ) : null}
                  {row.san === ply.san ? (
                    <span className="analysis-move-table-tag is-played">played</span>
                  ) : null}
                </td>
                <td>{row.pct != null ? `${row.pct}%` : '—'}</td>
                <td>{row.games != null ? row.games.toLocaleString() : '—'}</td>
              </tr>
            ))}
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

function arrowsForCommonReplies(moves: CommonReply[]): FrequencyArrow[] {
  if (moves.length === 0) return []
  const max = Math.max(...moves.map((move) => move.games), 1)
  return moves
    .filter((move) => move.uci.length >= 4)
    .map((move) => ({
      from: move.uci.slice(0, 2),
      to: move.uci.slice(2, 4),
      opacity: 0.22 + 0.73 * (move.games / max),
    }))
    .sort((a, b) => a.opacity - b.opacity)
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
  onFrequencyArrows,
  onPreviewMove,
  onPlaySan,
  playedSans = [],
  linePly = 0,
  lineLength = 0,
  onLineStep,
  tab: tabProp,
  onTabChange,
  pgn = '',
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
  const importWasBusy = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [pgnCopied, setPgnCopied] = useState(false)
  useEffect(() => {
    if (!pgnCopied) return
    const id = window.setTimeout(() => setPgnCopied(false), 1600)
    return () => window.clearTimeout(id)
  }, [pgnCopied])
  const [reviewCoachFraction, setReviewCoachFraction] = useState(
    DEFAULT_REVIEW_COACH_FRACTION,
  )
  const reviewReportRef = useRef<HTMLDivElement>(null)
  const previousCoachQuestionCount = useRef(0)
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
  const onFrequencyArrowsRef = useRef(onFrequencyArrows)
  onFrequencyArrowsRef.current = onFrequencyArrows
  const coachQuestionCount = useMemo(
    () => coachChat.filter((message) => message.role === 'user').length,
    [coachChat],
  )

  useEffect(() => {
    if (coachQuestionCount === 0) {
      previousCoachQuestionCount.current = 0
      setReviewCoachFraction(DEFAULT_REVIEW_COACH_FRACTION)
      return
    }
    if (previousCoachQuestionCount.current === 0) {
      setReviewCoachFraction(EXPANDED_REVIEW_COACH_FRACTION)
    }
    previousCoachQuestionCount.current = coachQuestionCount
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
    if (!open || tab !== 'games' || !replyPosition) {
      onFrequencyArrowsRef.current?.([])
      return
    }
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
          onFrequencyArrowsRef.current?.(arrowsForCommonReplies(moves))
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setCommonStatus('error')
          setCommonError(
            err instanceof Error ? err.message : 'Couldn’t read the explorer.',
          )
          onFrequencyArrowsRef.current?.([])
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
            <ExploreOpenings onPlaySan={onPlaySan} playedSans={playedSans} />
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
                    <div key={tag} className="analysis-counts-row">
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

              {onSendCoachChat && coachQuestionCount > 0 && (
                <>
                  <ReviewCoachResizeHandle
                    fraction={reviewCoachFraction}
                    containerRef={reviewReportRef}
                    onFractionChange={setReviewCoachFraction}
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
                    />
                  </div>
                </>
              )}
              {onSendCoachChat && coachQuestionCount === 0 && (
                <div className="analysis-coach-dock">
                  <CoachPane
                    explanation={null}
                    coachStatus={coachStatus}
                    coachError={coachError}
                    chatMessages={coachChat}
                    chatStatus={coachChatStatus}
                    chatError={coachChatError}
                    onSendChat={onSendCoachChat}
                    isPlayerTurn
                    reviewMode
                    compact
                  />
                </div>
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
      </aside>
    </div>
  )
}
