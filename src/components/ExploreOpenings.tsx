import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { createPortal } from 'react-dom'
import { Chess } from 'chess.js'
import {
  createColumnHelper,
  createExpandedRowModel,
  createSortedRowModel,
  flexRender,
  rowExpandingFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
  type ExpandedState,
  type SortingState,
} from '@tanstack/react-table'
import { ChevronRight } from 'lucide-react'
import { ExplorerFilters } from '@/components/ExplorerFilters'
import { monthEnd, monthStart, monthsCovered } from '@/components/ExplorerDateRange'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  loadExplorerRange,
  loadExplorerRatings,
  loadExplorerSpeeds,
  saveExplorerRange,
  saveExplorerRatings,
  saveExplorerSpeeds,
} from '@/lib/explorerFilterPrefs'
import { START_FEN } from '@/lib/fenBridge'
import { cn } from '@/lib/utils'
import {
  EXPLORER_MOVE_CAP,
  fetchLichessExplorer,
  isRatingBandId,
  normalizeMonths,
  normalizeRatings,
  normalizeSpeeds,
  openingExplorerApiUrl,
  sortByWinRate,
  whiteWinRate,
  type ExplorerMonth,
  type ExplorerOpening,
  type ExplorerSpeed,
  type RatingBandId,
} from '@/lib/lichessExplorer'

const DEBOUNCE_MS = 250
const WHITE_FIRST_MOVES = new Set(new Chess(START_FEN).moves())

const features = tableFeatures({
  rowExpandingFeature,
  rowSortingFeature,
  expandedRowModel: createExpandedRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
  },
})

type ExploreRow = {
  id: string
  san: string
  name: string
  eco: string
  white: number
  draws: number
  black: number
  averageRating: number
  engineCp: number | null
  engineDepth: number | null
  engineMate: number | null
  games: number
  /** Games in the position before this move. Share is games / parentGames. */
  parentGames: number
  winRate: number
  play: string
  path: string[]
  parentName: string
  kind: 'opening' | 'line' | 'defense' | 'status'
  canExpand: boolean
  subRows?: ExploreRow[]
}

type OpeningGroup = {
  san: string
  uci: string
  white: number
  draws: number
  black: number
  averageRating: number
  engineCp: number | null
  engineDepth: number | null
  engineMate: number | null
  opening: ExplorerOpening | null
}

type Snapshot = {
  key: string
  status: 'ready' | 'error'
  error: string | null
  groups: OpeningGroup[]
  total: number
}

const columnHelper = createColumnHelper<typeof features, ExploreRow>()
const ROW_WINDOW_OVERSCAN = 2
const ROW_HEIGHT_FALLBACK = 36

function engineSortValue(row: ExploreRow): number {
  if (row.kind === 'status') return Number.NEGATIVE_INFINITY
  if (row.engineMate !== null && row.engineMate !== 0) {
    return row.engineMate > 0 ? 100_000 + row.engineMate : -100_000 + row.engineMate
  }
  if (row.engineCp === null) return Number.NEGATIVE_INFINITY
  return row.engineCp
}

/** White's edge after the move. `+0.23` is a quarter pawn. */
function engineLabel(row: ExploreRow): string | null {
  if (row.kind === 'status') return null
  if (row.engineMate !== null && row.engineMate !== 0) {
    const marks = Math.abs(row.engineMate)
    return row.engineMate > 0 ? `+M${marks}` : `-M${marks}`
  }
  if (row.engineCp === null) return null
  const pawns = Math.abs(row.engineCp) / 100
  const text = pawns.toFixed(2)
  if (row.engineCp > 0) return `+${text}`
  if (row.engineCp < 0) return `-${text}`
  return '0.00'
}

function percentLabel(white: number, draws: number, black: number) {
  const total = white + draws + black
  const pct = (value: number) =>
    total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0%'
  return `White ${pct(white)} · Draw ${pct(draws)} · Black ${pct(black)}`
}

function bandsFromKey(ratingKey: string): RatingBandId[] {
  return normalizeRatings(
    ratingKey.split(',').filter((id): id is RatingBandId => isRatingBandId(id)),
  )
}

function lineLabel(name: string, parentName: string) {
  if (parentName && name.startsWith(`${parentName}: `)) {
    return name.slice(parentName.length + 2)
  }
  if (parentName && name.startsWith(`${parentName}, `)) {
    return name.slice(parentName.length + 2)
  }
  return name
}

function childLabel(name: string, parentName: string) {
  if (!name || name === parentName) return ''
  return lineLabel(name, parentName)
}

function counts(white: number, draws: number, black: number) {
  const games = white + draws + black
  const winRate = whiteWinRate({ white, draws, black })
  return { games, winRate }
}

/** Identity in the tree. `play` is the position and can repeat on a later row. */
function treeId(parentId: string, index: number, san: string, play: string) {
  return `${parentId}#${index}:${san}:${play}`
}

function statusRow(parentId: string, message: string): ExploreRow {
  return {
    id: `${parentId}#status`,
    san: '',
    name: message,
    eco: '',
    white: 0,
    draws: 0,
    black: 0,
    averageRating: 0,
    engineCp: null,
    engineDepth: null,
    engineMate: null,
    games: 0,
    parentGames: 0,
    winRate: -1,
    play: '',
    path: [],
    parentName: '',
    kind: 'status',
    canExpand: false,
  }
}

function groupToRow(group: OpeningGroup, index: number, parentGames: number): ExploreRow {
  const stats = counts(group.white, group.draws, group.black)
  return {
    id: treeId('root', index, group.san, group.uci),
    san: group.san,
    name: group.opening?.name ?? '',
    eco: group.opening?.eco ?? '',
    white: group.white,
    draws: group.draws,
    black: group.black,
    averageRating: group.averageRating,
    engineCp: group.engineCp,
    engineDepth: group.engineDepth,
    engineMate: group.engineMate,
    games: stats.games,
    parentGames,
    winRate: stats.winRate,
    play: group.uci,
    path: [group.san],
    parentName: '',
    kind: 'opening',
    canExpand: true,
  }
}

function findRow(rows: readonly ExploreRow[], id: string): ExploreRow | null {
  for (const row of rows) {
    if (row.id === id) return row
    if (row.subRows) {
      const found = findRow(row.subRows, id)
      if (found) return found
    }
  }
  return null
}

function sanKey(san: string) {
  return san.replace(/[+#]$/, '')
}

/** Next-move row whose UCI matches Stockfish’s top choice from the current position. */
function isRecommendedRow(
  row: ExploreRow,
  recommendedUci: string | null | undefined,
  playedLen: number,
) {
  if (!recommendedUci || row.kind === 'status') return false
  if (row.path.length !== playedLen + 1) return false
  const parts = row.play.split(',')
  return parts[parts.length - 1] === recommendedUci
}

/** Walk the played line, opening each move until its replies are loaded. */
function followPlayedLine(
  rows: readonly ExploreRow[],
  played: readonly string[],
  expanded: ExpandedState,
): { activeId: string | null; expanded: ExpandedState | null } {
  if (played.length === 0) return { activeId: null, expanded: null }
  const open: Record<string, boolean> = expanded === true ? {} : { ...expanded }
  let changed = false
  let list: readonly ExploreRow[] | undefined = rows
  let activeId: string | null = null
  for (let i = 0; i < played.length; i += 1) {
    if (!list) break
    const want = sanKey(played[i] ?? '')
    const match: ExploreRow | undefined = list.find(
      (row) => row.kind !== 'status' && sanKey(row.san) === want,
    )
    if (!match) break
    activeId = match.id
    if (match.canExpand && !open[match.id]) {
      open[match.id] = true
      changed = true
    }
    const loading =
      !match.subRows || (match.subRows.length === 1 && match.subRows[0]?.kind === 'status')
    if (i === played.length - 1 || loading) break
    list = match.subRows
  }
  return { activeId, expanded: changed ? open : null }
}

function patchRow(
  rows: readonly ExploreRow[],
  id: string,
  update: (row: ExploreRow) => ExploreRow,
): ExploreRow[] {
  return rows.map((row) => {
    if (row.id === id) return update(row)
    if (!row.subRows) return row
    return { ...row, subRows: patchRow(row.subRows, id, update) }
  })
}

async function loadGroups(
  ratings: RatingBandId[],
  speeds: ExplorerSpeed[],
  months: ExplorerMonth[],
  signal: AbortSignal,
): Promise<{ groups: OpeningGroup[]; total: number }> {
  const root = await fetchLichessExplorer(START_FEN, ratings, signal, {
    moves: EXPLORER_MOVE_CAP,
    speeds,
    months,
  })
  const groups = sortByWinRate(
    root.moves
      .filter((move) => WHITE_FIRST_MOVES.has(move.san))
      .map((move) => ({
        san: move.san,
        uci: move.uci,
        white: move.white,
        draws: move.draws,
        black: move.black,
        averageRating: move.averageRating,
        engineCp: move.engineCp,
        engineDepth: move.engineDepth,
        engineMate: move.engineMate,
        opening: move.opening,
      })),
    'white',
    (move) => move.san,
  )
  return { groups, total: root.white + root.draws + root.black }
}

async function loadChildRows(
  row: ExploreRow,
  ratings: RatingBandId[],
  speeds: ExplorerSpeed[],
  months: ExplorerMonth[],
  signal: AbortSignal,
): Promise<{ children: ExploreRow[] }> {
  const position = await fetchLichessExplorer(START_FEN, ratings, signal, {
    play: row.play,
    moves: EXPLORER_MOVE_CAP,
    speeds,
    months,
  })
  const ancestor = row.parentName || row.name
  const moves = sortByWinRate(position.moves, 'white', (move) => move.san)
  if (moves.length === 0) {
    return {
      children: [statusRow(row.id, 'No further moves in these filters.')],
    }
  }
  return {
    children: moves.map((move, index) => {
      const play = row.play ? `${row.play},${move.uci}` : move.uci
      const exactName = move.opening?.name ?? ''
      const label = childLabel(exactName, ancestor)
      const stats = counts(move.white, move.draws, move.black)
      return {
        id: treeId(row.id, index, move.san, play),
        san: move.san,
        name: label,
        eco: label ? (move.opening?.eco ?? '') : '',
        white: move.white,
        draws: move.draws,
        black: move.black,
        averageRating: move.averageRating,
        engineCp: move.engineCp,
        engineDepth: move.engineDepth,
        engineMate: move.engineMate,
        games: stats.games,
        parentGames: row.games,
        winRate: stats.winRate,
        play,
        path: [...row.path, move.san],
        parentName: exactName || ancestor,
        kind: 'line' as const,
        canExpand: true,
      }
    }),
  }
}

function ResultBar({
  white,
  draws,
  black,
  onTip,
  onHide,
}: {
  white: number
  draws: number
  black: number
  onTip: (point: { clientX: number; clientY: number }, text: string) => void
  onHide: () => void
}) {
  const games = white + draws + black
  if (games <= 0) return null
  const percents = percentLabel(white, draws, black)
  return (
    <div
      className="rating-band-bar"
      tabIndex={0}
      role="img"
      aria-label={percents}
      onMouseEnter={(event) => onTip(event, percents)}
      onFocus={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        onTip({ clientX: rect.left, clientY: rect.top }, percents)
      }}
      onMouseLeave={onHide}
      onBlur={onHide}
    >
      <span className="rating-band-bar-white" style={{ flexGrow: white }} />
      <span className="rating-band-bar-draw" style={{ flexGrow: draws }} />
      <span className="rating-band-bar-black" style={{ flexGrow: black }} />
    </div>
  )
}

function SortHeader({
  label,
  sorted,
  onToggle,
}: {
  label: string
  sorted: false | 'asc' | 'desc'
  onToggle?: (event: unknown) => void
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs font-medium"
      onClick={onToggle}
    >
      {label}
      {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : null}
    </button>
  )
}

function MoveTable({
  rows,
  ratings,
  speeds,
  months,
  playedSans,
  recommendedUci,
  onPlaySan,
}: {
  rows: ExploreRow[]
  ratings: RatingBandId[]
  speeds: ExplorerSpeed[]
  months: ExplorerMonth[]
  playedSans: string[]
  recommendedUci?: string | null
  onPlaySan?: (sans: string[], play?: string) => void
}) {
  const [data, setData] = useState(rows)
  const [expanded, setExpanded] = useState<ExpandedState>({})
  const [sorting, setSorting] = useState<SortingState>([{ id: 'winRate', desc: true }])
  const [span, setSpan] = useState({ start: 0, end: 40 })
  const [activeId, setActiveId] = useState<string | null>(null)
  const aborts = useRef(new Map<string, AbortController>())
  const loaded = useRef(new Set<string>())
  const dataRef = useRef(data)
  dataRef.current = data
  const playRef = useRef(onPlaySan)
  playRef.current = onPlaySan
  const tipRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const metrics = useRef({ rowH: ROW_HEIGHT_FALLBACK, headerH: 32, measured: false })
  const [rowH, setRowH] = useState(ROW_HEIGHT_FALLBACK)
  const rowCountRef = useRef(0)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const playedKey = playedSans.join(' ')

  const showTip = useCallback((point: { clientX: number; clientY: number }, text: string) => {
    const tip = tipRef.current
    if (!tip) return
    tip.textContent = text
    tip.hidden = false
    tip.style.left = `${point.clientX}px`
    tip.style.top = `${point.clientY}px`
  }, [])

  const hideTip = useCallback(() => {
    if (tipRef.current) tipRef.current.hidden = true
  }, [])

  const syncWindow = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const thead = el.querySelector('thead')
    if (thead) {
      const headerH = thead.getBoundingClientRect().height
      if (headerH > 0) metrics.current.headerH = headerH
    }
    const { rowH, headerH } = metrics.current
    const start = Math.max(
      0,
      Math.floor(Math.max(0, el.scrollTop - headerH) / rowH) - ROW_WINDOW_OVERSCAN,
    )
    const end = Math.min(
      rowCountRef.current,
      start + Math.ceil(el.clientHeight / rowH) + ROW_WINDOW_OVERSCAN * 2,
    )
    setSpan((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [])

  useEffect(() => {
    setData(rows)
    setExpanded({})
    loaded.current.clear()
    for (const controller of aborts.current.values()) controller.abort()
    aborts.current.clear()
  }, [rows])

  useEffect(() => {
    const controllers = aborts.current
    return () => {
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
    }
  }, [])

  useEffect(() => {
    if (expanded === true) return
    const current = dataRef.current
    for (const [id, open] of Object.entries(expanded)) {
      if (!open || loaded.current.has(id) || aborts.current.has(id)) continue
      const row = findRow(current, id)
      if (!row?.canExpand || row.subRows) continue
      loaded.current.add(id)
      const controller = new AbortController()
      aborts.current.set(id, controller)
      setData((current) =>
        patchRow(current, id, (item) => ({
          ...item,
          subRows: [statusRow(id, 'Loading lines…')],
        })),
      )
      void loadChildRows(row, ratings, speeds, months, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return
          setData((current) =>
            patchRow(current, id, (item) => ({
              ...item,
              subRows: result.children,
            })),
          )
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          if (err instanceof DOMException && err.name === 'AbortError') return
          loaded.current.delete(id)
          aborts.current.delete(id)
          const message = err instanceof Error ? err.message : 'Opening tree failed.'
          setData((current) =>
            patchRow(current, id, (item) => ({
              ...item,
              subRows: [statusRow(id, message)],
            })),
          )
        })
    }
  }, [expanded, ratings, speeds, months])

  useEffect(() => {
    const next = followPlayedLine(data, playedSans, expandedRef.current)
    setActiveId(next.activeId)
    if (next.expanded) setExpanded(next.expanded)
  }, [data, playedKey, playedSans])

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('san', {
          id: 'move',
          header: ({ header }) => (
            <SortHeader
              label="Move"
              sorted={header.column.getIsSorted()}
              onToggle={header.column.getToggleSortingHandler()}
            />
          ),
          cell: ({ row }) => {
            const item = row.original
            const title = item.san || item.name
            const detail =
              item.kind === 'line'
                ? item.name
                : item.kind === 'opening' || item.kind === 'defense'
                  ? `${item.eco ? `${item.eco} ` : ''}${item.name}`.trim()
                  : ''
            const playable = item.path.length > 0 && Boolean(item.san)
            return (
              <div
                className="flex min-w-0 items-center gap-1"
                style={{ paddingLeft: row.depth * 12 }}
              >
                {item.canExpand ? (
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={row.getIsExpanded() ? `Collapse ${title}` : `Expand ${title}`}
                    aria-expanded={row.getIsExpanded()}
                    onClick={(event) => {
                      event.stopPropagation()
                      row.toggleExpanded()
                    }}
                  >
                    <ChevronRight
                      className={cn('size-3 transition-transform', row.getIsExpanded() && 'rotate-90')}
                    />
                  </Button>
                ) : (
                  <span className="size-6 shrink-0" />
                )}
                {playable ? (
                  <span className="min-w-0 truncate text-left">
                    <span className="font-semibold">{title}</span>
                    {detail ? (
                      <span className="ml-1.5 font-normal text-muted-foreground">{detail}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className={cn('min-w-0 truncate', item.kind === 'status' && 'text-muted-foreground')}>
                    <span className="font-semibold">{title}</span>
                    {detail ? (
                      <span className="ml-1.5 font-normal text-muted-foreground">{detail}</span>
                    ) : null}
                  </span>
                )}
              </div>
            )
          },
          sortFn: 'alphanumeric',
        }),
        columnHelper.accessor((row) => (row.parentGames > 0 ? row.games / row.parentGames : -1), {
          id: 'share',
          header: ({ header }) => (
            <SortHeader
              label="%"
              sorted={header.column.getIsSorted()}
              onToggle={header.column.getToggleSortingHandler()}
            />
          ),
          cell: ({ row }) => {
            const item = row.original
            if (item.kind === 'status' || item.parentGames <= 0 || item.games <= 0) return null
            const share = item.games / item.parentGames
            const shown = (share * 100).toFixed(1)
            const label = share > 0 && shown === '0.0' ? '<0.1%' : `${shown}%`
            const rating =
              item.averageRating > 0
                ? ` · avg ${item.averageRating.toLocaleString('en-US')}`
                : ''
            const tip = `${item.games.toLocaleString('en-US')} of ${item.parentGames.toLocaleString('en-US')} games${rating}`
            return (
              <span
                className="cursor-help tabular-nums text-muted-foreground"
                tabIndex={0}
                onMouseEnter={(event) => showTip(event, tip)}
                onFocus={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  showTip({ clientX: rect.left, clientY: rect.top }, tip)
                }}
                onMouseLeave={hideTip}
                onBlur={hideTip}
              >
                {label}
              </span>
            )
          },
          sortFn: 'basic',
          sortDescFirst: true,
        }),
        columnHelper.accessor('winRate', {
          id: 'winRate',
          header: ({ header }) => (
            <SortHeader
              label="Win"
              sorted={header.column.getIsSorted()}
              onToggle={header.column.getToggleSortingHandler()}
            />
          ),
          cell: ({ row }) => {
            const item = row.original
            if (item.kind === 'status' || item.winRate < 0) return null
            return (
              <span className="tabular-nums font-semibold">
                {(item.winRate * 100).toFixed(1)}%
              </span>
            )
          },
          sortFn: 'basic',
          sortDescFirst: true,
        }),
        columnHelper.accessor(engineSortValue, {
          id: 'engine',
          header: ({ header }) => (
            <SortHeader
              label="Engine"
              sorted={header.column.getIsSorted()}
              onToggle={header.column.getToggleSortingHandler()}
            />
          ),
          cell: ({ row }) => {
            const label = engineLabel(row.original)
            if (!label) return null
            const depth = row.original.engineDepth
            const tip = depth !== null && depth > 0 ? `Depth ${depth}` : 'Saved engine score'
            return (
              <span
                className="cursor-help tabular-nums"
                tabIndex={0}
                onMouseEnter={(event) => showTip(event, tip)}
                onFocus={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  showTip({ clientX: rect.left, clientY: rect.top }, tip)
                }}
                onMouseLeave={hideTip}
                onBlur={hideTip}
              >
                {label}
              </span>
            )
          },
          sortFn: 'basic',
          sortDescFirst: true,
        }),
        columnHelper.display({
          id: 'result',
          header: 'Result',
          enableSorting: false,
          cell: ({ row }) =>
            row.original.kind === 'status' ? null : (
              <ResultBar
                white={row.original.white}
                draws={row.original.draws}
                black={row.original.black}
                onTip={showTip}
                onHide={hideTip}
              />
            ),
        }),
      ]),
    [hideTip, showTip],
  )

  const table = useTable({
    features,
    data,
    columns,
    getRowId: (row) => row.id,
    getSubRows: (row) => row.subRows,
    getRowCanExpand: (row) => row.original.canExpand,
    enableSortingRemoval: false,
    autoResetExpanded: false,
    state: { expanded, sorting },
    onExpandedChange: setExpanded,
    onSortingChange: setSorting,
    initialState: {
      sorting: [{ id: 'winRate', desc: true }],
    },
  })

  const modelRows = table.getRowModel().rows
  rowCountRef.current = modelRows.length

  useEffect(() => {
    syncWindow()
    const el = scrollerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => syncWindow())
    observer.observe(el)
    return () => observer.disconnect()
  }, [modelRows.length, syncWindow])

  const measureRow = useCallback((node: HTMLTableRowElement | null) => {
    if (!node || metrics.current.measured) return
    const height = node.getBoundingClientRect().height
    if (height <= 0) return
    metrics.current.measured = true
    if (Math.abs(height - metrics.current.rowH) > 0.5) {
      metrics.current.rowH = height
      setRowH(height)
    }
  }, [])

  useEffect(() => {
    if (!activeId) return
    const index = modelRows.findIndex((row) => row.id === activeId)
    const el = scrollerRef.current
    if (index < 0 || !el) return
    const top = metrics.current.headerH + index * metrics.current.rowH
    const bottom = top + metrics.current.rowH
    const viewTop = el.scrollTop + metrics.current.headerH
    const viewBottom = el.scrollTop + el.clientHeight
    if (top < viewTop || bottom > viewBottom) {
      el.scrollTop = Math.max(0, top - metrics.current.headerH - metrics.current.rowH)
    }
  }, [activeId, modelRows])

  const start = Math.min(span.start, modelRows.length)
  const end = Math.min(Math.max(span.end, start), modelRows.length)
  const visibleRows = modelRows.slice(start, end)
  const padTop = start * rowH
  const padBottom = (modelRows.length - end) * rowH

  return (
    <>
      <div ref={scrollerRef} className="explorer-table-scroll" onScroll={syncWindow}>
        <Table
          containerClassName="static overflow-visible"
          className="table-fixed border-separate border-spacing-0"
        >
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      'sticky top-0 z-10 h-8 bg-[var(--sw-bg0)] px-1.5 text-xs',
                      header.column.id === 'move'
                        ? 'w-[52%]'
                        : header.column.id === 'result'
                          ? 'w-[22%]'
                          : 'w-[13%]',
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {padTop > 0 ? (
              <tr aria-hidden="true">
                <td colSpan={4} style={{ height: padTop, padding: 0, border: 0 }} />
              </tr>
            ) : null}
            {visibleRows.map((row, index) => (
              <TableRow
                key={row.id}
                ref={index === 0 ? measureRow : undefined}
                className={cn(
                  'h-9',
                  row.getCanExpand() && 'is-expandable',
                  row.original.path.length > 0 && 'cursor-pointer',
                  row.id === activeId && 'is-current',
                  isRecommendedRow(row.original, recommendedUci, playedSans.length) &&
                    'is-recommended',
                )}
                data-san={row.original.san || undefined}
                data-row-id={row.id}
                onMouseDown={(event) => {
                  const target = event.target
                  if (target instanceof Element && target.closest('button')) return
                  event.preventDefault()
                }}
                onClick={() => {
                  const item = row.original
                  if (item.kind === 'status' || item.path.length === 0) return
                  playRef.current?.(item.path, item.play)
                }}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className="h-9 overflow-hidden px-1.5 py-0 text-xs"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {padBottom > 0 ? (
              <tr aria-hidden="true">
                <td colSpan={4} style={{ height: padBottom, padding: 0, border: 0 }} />
              </tr>
            ) : null}
          </TableBody>
        </Table>
      </div>
      {createPortal(<div ref={tipRef} className="explorer-tip" hidden />, document.body)}
    </>
  )
}

export const ExploreOpenings: FC<{
  onPlaySan?: (sans: string[], play?: string) => void
  playedSans?: string[]
  /** Stockfish best UCI for the current board position. */
  recommendedUci?: string | null
}> = ({ onPlaySan, playedSans = [], recommendedUci = null }) => {
  const [ratings, setRatings] = useState<RatingBandId[]>(() => loadExplorerRatings())
  const [speeds, setSpeeds] = useState<ExplorerSpeed[]>(() => loadExplorerSpeeds())
  const [availableMonths, setAvailableMonths] = useState<ExplorerMonth[]>([])
  const [rangeFrom, setRangeFrom] = useState<Date | null>(null)
  const [rangeTo, setRangeTo] = useState<Date | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const selected = useMemo(() => normalizeRatings(ratings), [ratings])
  const selectedSpeeds = useMemo(() => normalizeSpeeds(speeds), [speeds])
  const selectedMonths = useMemo(() => {
    if (!rangeFrom || !rangeTo || availableMonths.length === 0) return []
    const covered = monthsCovered(availableMonths, rangeFrom, rangeTo)
    if (covered.length === availableMonths.length) return []
    return normalizeMonths(covered)
  }, [availableMonths, rangeFrom, rangeTo])
  const ratingKey = selected.join(',')
  const speedKey = selectedSpeeds.join(',')
  const monthKey = selectedMonths.join(',')
  const filterKey = `${ratingKey}|${speedKey}|${monthKey}`
  const bands = useMemo(() => bandsFromKey(ratingKey), [ratingKey])
  const requestUrl = openingExplorerApiUrl(START_FEN, selected, {
    moves: EXPLORER_MOVE_CAP,
    speeds: selectedSpeeds,
    months: selectedMonths,
  })
  const current = snapshot && snapshot.key === filterKey ? snapshot : null
  const whiteStatus = current?.status ?? 'loading'
  const whiteRows = useMemo(
    () =>
      current?.status === 'ready'
        ? current.groups.map((group, index) => groupToRow(group, index, current.total))
        : [],
    [current],
  )

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/explorer-months', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('months'))))
      .then((body: { months?: unknown }) => {
        if (controller.signal.aborted) return
        const months = normalizeMonths(
          Array.isArray(body.months) ? body.months.filter((month) => typeof month === 'string') : [],
        )
        setAvailableMonths(months)
        if (months.length === 0) return
        const fullFrom = monthStart(months[0])
        const fullTo = monthEnd(months[months.length - 1])
        const saved = loadExplorerRange()
        if (!saved) {
          setRangeFrom(fullFrom)
          setRangeTo(fullTo)
          return
        }
        const from = saved.from < fullFrom ? fullFrom : saved.from
        const to = saved.to > fullTo ? fullTo : saved.to
        if (from > to) {
          setRangeFrom(fullFrom)
          setRangeTo(fullTo)
          return
        }
        setRangeFrom(from)
        setRangeTo(to)
      })
      .catch(() => {
        if (controller.signal.aborted) return
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const key = filterKey
    const timer = window.setTimeout(() => {
      void loadGroups(bands, selectedSpeeds, selectedMonths, controller.signal)
        .then((loaded) => {
          if (controller.signal.aborted) return
          setSnapshot({ key, status: 'ready', error: null, groups: loaded.groups, total: loaded.total })
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          if (err instanceof DOMException && err.name === 'AbortError') return
          setSnapshot({
            key,
            status: 'error',
            error: err instanceof Error ? err.message : 'Lichess explorer failed.',
            groups: [],
            total: 0,
          })
        })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [bands, filterKey, selectedMonths, selectedSpeeds])

  useEffect(() => {
    saveExplorerRatings(selected)
  }, [selected])

  useEffect(() => {
    saveExplorerSpeeds(selectedSpeeds)
  }, [selectedSpeeds])

  const activeRows = whiteRows
  const activeError = current?.error
  const activeLoading = whiteStatus === 'loading'

  return (
    <section
      className="rating-band"
      aria-label="Opening explorer"
      aria-busy={activeLoading}
      data-explorer-url={requestUrl}
      data-ratings={selected.join(',')}
      data-speeds={selectedSpeeds.join(',')}
      data-months={monthKey || 'all'}
    >
      <div className="rating-band-head">
        <h3 className="rating-band-title" id="explore-heading">
          Openings
        </h3>
      </div>
      <ExplorerFilters
        ratings={selected}
        speeds={selectedSpeeds}
        availableMonths={availableMonths}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onRatingsChange={setRatings}
        onSpeedsChange={setSpeeds}
        onRangeChange={(from, to) => {
          setRangeFrom(from)
          setRangeTo(to)
          saveExplorerRange(from, to)
        }}
      />
      {activeLoading ? (
        <p className="rating-band-note" role="status">
          Loading openings…
        </p>
      ) : null}
      {activeError ? (
        <p className="rating-band-note is-error" role="alert">
          {activeError}
        </p>
      ) : null}
      {!activeLoading && !activeError && activeRows.length === 0 ? (
        <p className="rating-band-note" role="status">
          No rated games in these bands reached the starting position.
        </p>
      ) : null}
      {activeRows.length > 0 ? (
        <MoveTable
          key={filterKey}
          rows={activeRows}
          ratings={bands}
          speeds={selectedSpeeds}
          months={selectedMonths}
          playedSans={playedSans}
          recommendedUci={recommendedUci}
          onPlaySan={onPlaySan}
        />
      ) : null}
    </section>
  )
}
