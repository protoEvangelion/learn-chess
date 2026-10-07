import { useEffect, useMemo, useRef, useState, type FC } from 'react'
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
import { RatingBandMultiSelect } from '@/components/RatingBandMultiSelect'
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { START_FEN } from '@/lib/fenBridge'
import { cn } from '@/lib/utils'
import {
  DEFAULT_RATING_BAND,
  EXPLORER_MOVE_CAP,
  blackWinRate,
  fetchBlackDefenses,
  fetchLichessExplorer,
  fetchOpeningBranch,
  isOpeningVariation,
  isRatingBandId,
  normalizeRatings,
  openingExplorerApiUrl,
  sortBlackDefenses,
  sortBranchLines,
  sortByWinRate,
  whiteWinRate,
  type ExplorerOpening,
  type OpeningBranchLine,
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

type Side = 'white' | 'black'

type ExploreRow = {
  id: string
  san: string
  name: string
  eco: string
  white: number
  draws: number
  black: number
  averageRating: number
  games: number
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
  opening: ExplorerOpening | null
}

type Snapshot = {
  key: string
  status: 'ready' | 'error'
  error: string | null
  groups: OpeningGroup[]
}

const columnHelper = createColumnHelper<typeof features, ExploreRow>()

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

function childLineText(line: OpeningBranchLine, parentName: string) {
  if (!line.name || line.name === parentName) return line.san ?? ''
  const variation = lineLabel(line.name, parentName)
  const titled = line.san ? `${line.san} - ${variation}` : variation
  if (parentName) return titled
  return `${line.eco ? `${line.eco} ` : ''}${titled}`.trim()
}

function moverForPlay(play: string): 'white' | 'black' {
  return play.split(',').filter(Boolean).length % 2 === 1 ? 'white' : 'black'
}

function counts(white: number, draws: number, black: number, side: Side) {
  const games = white + draws + black
  const winRate = side === 'black' ? blackWinRate({ white, draws, black }) : whiteWinRate({ white, draws, black })
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
    games: 0,
    winRate: -1,
    play: '',
    path: [],
    parentName: '',
    kind: 'status',
    canExpand: false,
  }
}

function lineToRow(
  line: OpeningBranchLine,
  parentName: string,
  path: string[],
  parentId: string,
  index: number,
): ExploreRow {
  const san = line.san ?? ''
  const play = line.play ?? ''
  const stats = counts(line.white, line.draws, line.black, 'white')
  return {
    id: treeId(parentId, index, san, play),
    san,
    name: childLineText(line, parentName),
    eco: line.eco,
    white: line.white,
    draws: line.draws,
    black: line.black,
    averageRating: line.averageRating,
    games: stats.games,
    winRate: stats.winRate,
    play,
    path: san ? [...path, san] : path,
    parentName,
    kind: 'line',
    canExpand: Boolean(line.play),
  }
}

function groupToRow(group: OpeningGroup, index: number): ExploreRow {
  const stats = counts(group.white, group.draws, group.black, 'white')
  return {
    id: treeId('root', index, group.san, group.uci),
    san: group.san,
    name: group.opening?.name ?? '',
    eco: group.opening?.eco ?? '',
    white: group.white,
    draws: group.draws,
    black: group.black,
    averageRating: group.averageRating,
    games: stats.games,
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
  signal: AbortSignal,
): Promise<OpeningGroup[]> {
  const root = await fetchLichessExplorer(START_FEN, ratings, signal, {
    moves: EXPLORER_MOVE_CAP,
  })
  return sortByWinRate(
    root.moves
      .filter((move) => WHITE_FIRST_MOVES.has(move.san))
      .map((move) => ({
        san: move.san,
        uci: move.uci,
        white: move.white,
        draws: move.draws,
        black: move.black,
        averageRating: move.averageRating,
        opening: move.opening,
      })),
    'white',
    (move) => move.san,
  )
}

async function loadChildRows(
  row: ExploreRow,
  ratings: RatingBandId[],
  signal: AbortSignal,
): Promise<{ children: ExploreRow[]; name: string; eco: string }> {
  const branch = await fetchOpeningBranch(START_FEN, ratings, row.play, signal)
  const parent = branch.opening?.name || row.name || row.parentName
  let lines = sortBranchLines(
    branch.lines.filter(
      (child) => child.play !== row.play && isOpeningVariation(parent, child.name),
    ),
  )
  if (lines.length === 0 && row.kind === 'line') {
    const position = await fetchLichessExplorer(START_FEN, ratings, signal, {
      play: row.play,
      moves: EXPLORER_MOVE_CAP,
    })
    lines = sortBranchLines(
      position.moves.map((move) => {
        const reached = row.play ? `${row.play},${move.uci}` : move.uci
        const openingName = move.opening?.name ?? ''
        const named = Boolean(openingName) && openingName !== parent
        return {
          name: named ? openingName : '',
          eco: named ? (move.opening?.eco ?? '') : '',
          san: move.san,
          play: reached,
          white: move.white,
          draws: move.draws,
          black: move.black,
          averageRating: move.averageRating,
          mover: moverForPlay(reached),
        }
      }),
    )
  }
  const name = branch.opening?.name || row.name
  const eco = branch.opening?.eco || row.eco
  if (lines.length === 0) {
    const label = lineLabel(name, row.parentName) || row.san
    return {
      name,
      eco,
      children: [
        statusRow(
          row.id,
          row.kind === 'opening'
            ? `Lichess did not name a line under ${row.san} for these bands.`
            : `Lichess did not name a line under ${label}.`,
        ),
      ],
    }
  }
  return {
    name,
    eco,
    children: lines.map((line, index) => lineToRow(line, parent, row.path, row.id, index)),
  }
}

function ResultBar({
  white,
  draws,
  black,
}: {
  white: number
  draws: number
  black: number
}) {
  const games = white + draws + black
  if (games <= 0) return null
  const percents = percentLabel(white, draws, black)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="rating-band-bar" tabIndex={0} role="img" aria-label={percents}>
          <span className="rating-band-bar-white" style={{ flexGrow: white }} />
          <span className="rating-band-bar-draw" style={{ flexGrow: draws }} />
          <span className="rating-band-bar-black" style={{ flexGrow: black }} />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {percents}
      </TooltipContent>
    </Tooltip>
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
  onPlaySan,
}: {
  rows: ExploreRow[]
  ratings: RatingBandId[]
  onPlaySan?: (sans: string[], play?: string) => void
}) {
  const [data, setData] = useState(rows)
  const [expanded, setExpanded] = useState<ExpandedState>({})
  const [sorting, setSorting] = useState<SortingState>([{ id: 'winRate', desc: true }])
  const aborts = useRef(new Map<string, AbortController>())
  const loaded = useRef(new Set<string>())

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
    for (const [id, open] of Object.entries(expanded)) {
      if (!open || loaded.current.has(id) || aborts.current.has(id)) continue
      const row = findRow(data, id)
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
      void loadChildRows(row, ratings, controller.signal)
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
  }, [data, expanded, ratings])

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
            const title = item.kind === 'line' ? item.name || item.san : item.san || item.name
            const detail =
              item.kind === 'opening' || item.kind === 'defense'
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
                    onClick={row.getToggleExpandedHandler()}
                  >
                    <ChevronRight
                      className={cn('size-3 transition-transform', row.getIsExpanded() && 'rotate-90')}
                    />
                  </Button>
                ) : (
                  <span className="size-6 shrink-0" />
                )}
                {playable ? (
                  <button
                    type="button"
                    className="min-w-0 truncate text-left"
                    onClick={() => onPlaySan?.(item.path, item.play)}
                  >
                    <span className="font-semibold">{title}</span>
                    {detail ? (
                      <span className="ml-1.5 font-normal text-muted-foreground">{detail}</span>
                    ) : null}
                  </button>
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
        columnHelper.accessor('games', {
          id: 'games',
          header: ({ header }) => (
            <SortHeader
              label="Games"
              sorted={header.column.getIsSorted()}
              onToggle={header.column.getToggleSortingHandler()}
            />
          ),
          cell: ({ row }) => {
            const item = row.original
            if (item.kind === 'status' || item.games <= 0) return null
            const label = item.games.toLocaleString('en-US')
            if (item.averageRating <= 0) {
              return <span className="tabular-nums text-muted-foreground">{label}</span>
            }
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help tabular-nums text-muted-foreground" tabIndex={0}>
                    {label}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  Average rating {item.averageRating.toLocaleString('en-US')}
                </TooltipContent>
              </Tooltip>
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
              />
            ),
        }),
      ]),
    [onPlaySan],
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

  return (
    <Table className="table-fixed">
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead
                key={header.id}
                className={cn(
                  'h-8 px-1.5 text-xs',
                  header.column.id === 'move' ? 'w-[46%]' : 'w-[18%]',
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
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id} data-san={row.original.san || undefined}>
            {row.getAllCells().map((cell) => (
              <TableCell
                key={cell.id}
                className={cn(
                  'overflow-hidden px-1.5 py-1.5 text-xs',
                  cell.column.id === 'move' && 'whitespace-normal',
                )}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export const ExploreOpenings: FC<{
  onPlaySan?: (sans: string[], play?: string) => void
}> = ({ onPlaySan }) => {
  const [ratings, setRatings] = useState<RatingBandId[]>([DEFAULT_RATING_BAND])
  const [side, setSide] = useState<Side>('white')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [defenses, setDefenses] = useState<ExploreRow[] | null>(null)
  const [defenseError, setDefenseError] = useState<string | null>(null)
  const [defenseLoading, setDefenseLoading] = useState(false)
  const selected = normalizeRatings(ratings)
  const ratingKey = selected.join(',')
  const bands = useMemo(() => bandsFromKey(ratingKey), [ratingKey])
  const requestUrl = openingExplorerApiUrl(START_FEN, selected, {
    moves: EXPLORER_MOVE_CAP,
  })
  const current = snapshot && snapshot.key === ratingKey ? snapshot : null
  const whiteStatus = current?.status ?? 'loading'
  const whiteRows = useMemo(
    () => (current?.status === 'ready' ? current.groups.map((group, index) => groupToRow(group, index)) : []),
    [current],
  )

  useEffect(() => {
    const controller = new AbortController()
    const key = ratingKey
    const timer = window.setTimeout(() => {
      void loadGroups(bands, controller.signal)
        .then((groups) => {
          if (controller.signal.aborted) return
          setSnapshot({ key, status: 'ready', error: null, groups })
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          if (err instanceof DOMException && err.name === 'AbortError') return
          setSnapshot({
            key,
            status: 'error',
            error: err instanceof Error ? err.message : 'Lichess explorer failed.',
            groups: [],
          })
        })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [bands, ratingKey])

  useEffect(() => {
    if (side !== 'black') return
    const controller = new AbortController()
    setDefenseLoading(true)
    setDefenseError(null)
    setDefenses(null)
    void fetchBlackDefenses(START_FEN, bands, controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return
        setDefenses(
          sortBlackDefenses(list.defenses).map((defense, index) => {
            const stats = counts(defense.white, defense.draws, defense.black, 'black')
            return {
              id: treeId('black', index, defense.san, defense.name),
              san: defense.san,
              name: defense.name,
              eco: defense.eco,
              white: defense.white,
              draws: defense.draws,
              black: defense.black,
              averageRating: defense.averageRating,
              games: stats.games,
              winRate: stats.winRate,
              play: '',
              path: [],
              parentName: '',
              kind: 'defense' as const,
              canExpand: false,
            }
          }),
        )
        setDefenseLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setDefenseError(err instanceof Error ? err.message : 'Opening defenses failed.')
        setDefenseLoading(false)
      })
    return () => controller.abort()
  }, [bands, side])

  const activeRows = side === 'white' ? whiteRows : (defenses ?? [])
  const activeError = side === 'white' ? current?.error : defenseError
  const activeLoading = side === 'white' ? whiteStatus === 'loading' : defenseLoading

  return (
    <section
      className="rating-band"
      aria-label="Opening explorer"
      aria-busy={activeLoading}
      data-explorer-url={requestUrl}
      data-ratings={selected.join(',')}
    >
      <div className="rating-band-head">
        <h3 className="rating-band-title" id="explore-heading">
          Openings
        </h3>
        <RatingBandMultiSelect value={selected} onChange={setRatings} />
      </div>
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          variant={side === 'white' ? 'secondary' : 'ghost'}
          aria-pressed={side === 'white'}
          onClick={() => setSide('white')}
        >
          White
        </Button>
        <Button
          type="button"
          size="sm"
          variant={side === 'black' ? 'secondary' : 'ghost'}
          aria-pressed={side === 'black'}
          onClick={() => setSide('black')}
        >
          Black
        </Button>
      </div>
      {activeLoading ? (
        <p className="rating-band-note" role="status">
          {side === 'white' ? 'Loading openings…' : 'Loading defenses…'}
        </p>
      ) : null}
      {activeError ? (
        <p className="rating-band-note is-error" role="alert">
          {activeError}
        </p>
      ) : null}
      {!activeLoading && !activeError && activeRows.length === 0 ? (
        <p className="rating-band-note" role="status">
          {side === 'white'
            ? 'No rated games in these bands reached the starting position.'
            : 'Lichess did not name a defense for these bands.'}
        </p>
      ) : null}
      {activeRows.length > 0 ? (
        <TooltipProvider delayDuration={250}>
          <MoveTable
            key={`${side}:${ratingKey}`}
            rows={activeRows}
            ratings={bands}
            onPlaySan={onPlaySan}
          />
        </TooltipProvider>
      ) : null}
    </section>
  )
}
