import type { Dispatch, FC, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Board, Position, Tile } from '@logic/board'
import { checkIfPositionsMatch } from '@logic/board'
import type { Color, Move, Piece, PieceType } from '@logic/pieces'
import { checkIfSelectedPieceCanMoveHere } from '@logic/pieces'
import {
  PIECE_SAFETY_COLOR,
  positionKey,
  tradeMarkerLabel,
  washColorForPreview,
} from '@/logic/movePreview'
import { useBoardPlay, type GameOver } from '@/components/useBoardPlay'
import { EvalBar2D } from '@/components/EvalBar2D'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const DARK = '#769656'
const LIGHT = '#eeeed2'
const LAST_DARK = '#baca2b'
const LAST_LIGHT = '#f6f669'

/** Mouse needs 5px to count as a drag; a fingertip wobbles more than that. */
const DRAG_SLOP_MOUSE = 5
const DRAG_SLOP_TOUCH = 10

function spriteSrc(type: PieceType, color: Color) {
  return `/assets/pieces-2d/${type}-${color === 'white' ? 'w' : 'b'}.svg`
}

function algebraic(pos: Position) {
  return `${FILES[pos.x]}${8 - pos.y}`
}

type DragSession = {
  pointerId: number
  /** `touch`/`pen` get a wider slop and no floating preview tooltip. */
  pointerType: string
  startX: number
  startY: number
  x: number
  y: number
  moved: boolean
  reclick: boolean
  type: PieceType
  color: Color
  /** Board box sampled once at pointerdown; a drag cannot scroll or resize the board. */
  rect: DOMRect
  /** Last destination the finger was over, so hover work runs per square, not per move event. */
  hoverKey: string | null
}

function squareFromRect(rect: DOMRect, clientX: number, clientY: number): Position | null {
  const x = clientX - rect.left
  const y = clientY - rect.top
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null
  return {
    x: Math.min(7, Math.floor((x / rect.width) * 8)),
    y: Math.min(7, Math.floor((y / rect.height) * 8)),
  }
}

export const Board2D: FC<{
  selected: Piece | null
  setSelected: (piece: Piece | null) => void
  board: Board
  setBoard: Dispatch<SetStateAction<Board>>
  moves: Move[]
  setMoves: (moves: Move[]) => void
  setGameOver: (gameOver: GameOver | null) => void
  playerColor: Color
  /** Who sits at the bottom. Black flips files and ranks. */
  seat: Color
  tipFrom?: Position | null
  tipTo?: Position | null
  wrongFrom?: Position | null
  wrongTo?: Position | null
  pendingEngineMove?: Move | null
  onEngineMoveConsumed?: () => void
  showMoveIndicators?: boolean
  readOnly?: boolean
  playBothSides?: boolean
  validateMove?: (move: Move) => boolean
  highlightMove?: { from: Position; to: Position } | null
  /** Turn the piece sprites to face the active player (two-player auto flip). */
  pieceYaw?: number
  /** 0–100, White's share for the eval bar beside the board. */
  evalWhitePercent?: number
  /** Short eval label, e.g. "+0.20" or "mate in 3". */
  evalLabel?: string
}> = ({
  selected,
  setSelected,
  board,
  setBoard,
  moves,
  setMoves,
  setGameOver,
  playerColor,
  seat,
  tipFrom = null,
  tipTo = null,
  wrongFrom = null,
  wrongTo = null,
  pendingEngineMove = null,
  onEngineMoveConsumed,
  showMoveIndicators = true,
  readOnly = false,
  playBothSides = false,
  validateMove,
  highlightMove,
  pieceYaw = 0,
  evalWhitePercent = 50,
  evalLabel = '—',
}) => {
  const play = useBoardPlay({
    selected,
    setSelected,
    board,
    setBoard,
    moves,
    setMoves,
    setGameOver,
    playerColor,
    pendingEngineMove,
    onEngineMoveConsumed,
    showMoveIndicators,
    readOnly,
    playBothSides,
    validateMove,
    highlightMove,
    autoSettle: true,
  })

  const boardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragSession | null>(null)
  const frameRef = useRef(0)
  const ghostRef = useRef<HTMLImageElement | null>(null)
  /** Set once per drag: mounting a ghost is the only render a drag is allowed. */
  const [ghost, setGhost] = useState<{
    type: PieceType
    color: Color
    size: number
  } | null>(null)

  const flipped = seat === 'black'
  /** Whoever may pick up a piece right now; their squares swallow the gesture. */
  const sideToMove = playBothSides ? play.turn : playerColor

  /** Ghost follows the finger through the compositor, not through React. */
  const placeGhost = useCallback(
    (x: number, y: number) => {
      const el = ghostRef.current
      if (!el) return
      const yaw = pieceYaw ? ` rotate(${pieceYaw}rad)` : ''
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -55%)${yaw}`
    },
    [pieceYaw],
  )

  const handlePreviewHoverRef = useRef(play.handlePreviewHover)
  handlePreviewHoverRef.current = play.handlePreviewHover
  const movePreviewsRef = useRef(play.movePreviews)
  movePreviewsRef.current = play.movePreviews

  /** Hover work is square-granular: crossing into a new square, not every move event. */
  const updateHover = useCallback((session: DragSession) => {
    const sq = squareFromRect(session.rect, session.x, session.y)
    const dest = sq
      ? { x: flipped ? 7 - sq.x : sq.x, y: flipped ? 7 - sq.y : sq.y }
      : null
    const key = dest ? positionKey(dest) : null
    if (key === session.hoverKey) return
    session.hoverKey = key
    const preview = key ? (movePreviewsRef.current?.get(key) ?? null) : null
    if (!preview) {
      handlePreviewHoverRef.current(null, 0, 0, null)
      return
    }
    handlePreviewHoverRef.current(
      preview,
      session.x,
      session.y,
      key,
      session.pointerType === 'mouse',
    )
  }, [flipped])

  const scheduleFrame = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      const session = dragRef.current
      if (!session?.moved) return
      placeGhost(session.x, session.y)
      updateHover(session)
    })
  }, [placeGhost, updateHover])

  const endSession = useCallback(() => {
    dragRef.current = null
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
    setGhost(null)
  }, [])

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, tile: Tile) => {
    if (e.button !== 0) return
    if (readOnly) return
    // A second finger landing mid-drag must not restart it. A different
    // pointer id means the old one is gone, so clear the stale session.
    if (dragRef.current) {
      if (dragRef.current.pointerId === e.pointerId) return
      endSession()
    }

    const reclick = !!tile.piece && selected?.getId() === tile.piece.getId()
    const started = play.startPieceDrag(tile)
    if (started && tile.piece) {
      const rect = boardRef.current?.getBoundingClientRect()
      if (!rect) return
      dragRef.current = {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        moved: false,
        reclick,
        type: tile.piece.type,
        color: tile.piece.color,
        rect,
        hoverKey: null,
      }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // Safari can drop the pointer between down and capture; drag still works.
      }
      return
    }
    if (selected) play.commitSquare(tile.position)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragRef.current
    if (!session || session.pointerId !== e.pointerId) return

    session.x = e.clientX
    session.y = e.clientY

    if (!session.moved) {
      if (e.pointerType === 'mouse') {
        // Coalesced mouse moves are the smoothest source for a pointer trail.
        const events = e.nativeEvent.getCoalescedEvents?.() ?? []
        const last = events[events.length - 1]
        if (last) {
          session.x = last.clientX
          session.y = last.clientY
        }
      }
      const slop =
        session.pointerType === 'mouse' ? DRAG_SLOP_MOUSE : DRAG_SLOP_TOUCH
      if (Math.hypot(session.x - session.startX, session.y - session.startY) <= slop) {
        return
      }
      session.moved = true
      setGhost({
        type: session.type,
        color: session.color,
        size: session.rect.width / 8,
      })
    }

    scheduleFrame()
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragRef.current
    if (!session || session.pointerId !== e.pointerId) return
    endSession()

    if (!session.moved) {
      play.releaseDrag()
      if (session.reclick) play.clearSelection()
      return
    }
    const sq = squareFromRect(session.rect, e.clientX, e.clientY)
    play.endDrag(
      sq ? { x: flipped ? 7 - sq.x : sq.x, y: flipped ? 7 - sq.y : sq.y } : null,
    )
  }

  const onPointerCancel = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragRef.current
    if (!session || session.pointerId !== e.pointerId) return
    endSession()
    play.cancelDrag()
  }

  return (
    <div className="board-2d-wrap">
      <div className="board-2d-figure">
        <EvalBar2D whitePercent={evalWhitePercent} label={evalLabel} />
        <div
          ref={boardRef}
          className="board-2d"
          role="grid"
          aria-label={
            flipped
              ? 'Chess board, Black at the bottom'
              : 'Chess board, White at the bottom'
          }
          // Long-press on a piece must not open the iOS share sheet.
          onContextMenu={(e) => e.preventDefault()}
        >
          {board.map((row) =>
            row.map((tile) => {
              const { x, y } = tile.position
              const col = flipped ? 7 - x : x
              const rowIndex = flipped ? 7 - y : y
              const dark = (x + y) % 2 === 1
              const canMoveHere = checkIfSelectedPieceCanMoveHere({
                tile,
                moves,
                selected,
              })
              const isTip =
                checkIfPositionsMatch(tile.position, tipFrom) ||
                checkIfPositionsMatch(tile.position, tipTo)
              const isCheck = checkIfPositionsMatch(tile.position, play.checkedKingPos)
              const isLastMove =
                !!play.lastMoveSquares &&
                (checkIfPositionsMatch(tile.position, play.lastMoveSquares.from) ||
                  checkIfPositionsMatch(tile.position, play.lastMoveSquares.to))
              const isWrong =
                checkIfPositionsMatch(tile.position, wrongFrom) ||
                checkIfPositionsMatch(tile.position, wrongTo)
              const isPremove =
                !!play.premove &&
                (checkIfPositionsMatch(tile.position, play.premove.from) ||
                  checkIfPositionsMatch(tile.position, play.premove.to))
              const preview = canMoveHere
                ? (play.movePreviews?.get(positionKey(canMoveHere.newPosition)) ?? null)
                : null
              const safety = play.safetyBySquare?.get(positionKey(tile.position)) ?? null
              const showLast = isLastMove && !isWrong && !isPremove
              let background = dark ? DARK : LIGHT
              if (showLast) background = dark ? LAST_DARK : LAST_LIGHT
              const coordColor = showLast
                ? '#6a7a29'
                : dark
                  ? LIGHT
                  : DARK
              const name = algebraic(tile.position)
              const piece = tile.piece
              const faded =
                !!ghost && !!piece && play.dragPieceId === piece.getId()
              const capture = !!canMoveHere && !!piece

              return (
                <button
                  key={`${x}-${y}`}
                  type="button"
                  role="gridcell"
                  className="board-2d-sq"
                  data-square={name}
                  aria-label={
                    piece
                      ? `${name} ${piece.color} ${piece.type}`
                      : `${name} empty`
                  }
                  style={{
                    gridColumn: col + 1,
                    gridRow: rowIndex + 1,
                    background,
                    // Only a grabbable piece needs to own the touch gesture.
                    // Empty squares keep panning available on a zoomed board.
                    touchAction:
                      !readOnly && piece?.color === sideToMove ? 'none' : undefined,
                  }}
                  onPointerDown={(e) => onPointerDown(e, tile)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                  onLostPointerCapture={onPointerCancel}
                  onPointerEnter={(e) => {
                    // Touch has no hover: the tap already selected the piece.
                    if (e.pointerType !== 'mouse') return
                    if (dragRef.current?.moved || !canMoveHere || !preview) return
                    play.handlePreviewHover(
                      preview,
                      e.clientX,
                      e.clientY,
                      positionKey(canMoveHere.newPosition),
                    )
                  }}
                  onPointerLeave={() => {
                    if (dragRef.current?.moved) return
                    play.handlePreviewHover(null, 0, 0, null)
                  }}
                >
                  {showMoveIndicators && preview && (
                    <span
                      className="board-2d-wash"
                      style={{ background: washColorForPreview(preview) }}
                    />
                  )}
                  {isWrong && <span className="board-2d-wash board-2d-wrong" />}
                  {isPremove && !isWrong && (
                    <span className="board-2d-wash board-2d-premove" />
                  )}
                  {isCheck && <span className="board-2d-check" />}
                  {isTip && <span className="board-2d-tip" />}
                  {play.showOppCheckRing &&
                    checkIfPositionsMatch(tile.position, play.oppKingPos) && (
                      <span className="board-2d-opp-check" />
                    )}
                  {safety && safety !== 'safe' && (
                    <span
                      className="board-2d-safety"
                      style={{ boxShadow: `inset 0 0 0 3px ${PIECE_SAFETY_COLOR[safety]}` }}
                    />
                  )}
                  {canMoveHere && !capture && <span className="board-2d-dot" />}
                  {canMoveHere && capture && <span className="board-2d-ring" />}
                  {col === 0 && (
                    <span className="board-2d-coord rank" style={{ color: coordColor }}>
                      {8 - y}
                    </span>
                  )}
                  {rowIndex === 7 && (
                    <span className="board-2d-coord file" style={{ color: coordColor }}>
                      {FILES[x]}
                    </span>
                  )}
                  {piece && (
                    <img
                      className={`board-2d-piece${faded ? ' is-faded' : ''}`}
                      src={spriteSrc(piece.type, piece.color)}
                      alt=""
                      draggable={false}
                      style={
                        pieceYaw
                          ? { transform: `rotate(${pieceYaw}rad)` }
                          : undefined
                      }
                    />
                  )}
                  {preview?.captureTrade && (
                    <span
                      className="board-2d-trade"
                      style={{ color: preview.captureTrade.label === 'losing' ? '#ff4040' : '#ecfdf5' }}
                    >
                      {tradeMarkerLabel(preview.captureTrade)}
                    </span>
                  )}
                </button>
              )
            }),
          )}
        </div>
      </div>
      {ghost && (
        <img
          ref={(el) => {
            ghostRef.current = el
            if (el) placeGhost(dragRef.current?.x ?? 0, dragRef.current?.y ?? 0)
          }}
          className="board-2d-ghost"
          src={spriteSrc(ghost.type, ghost.color)}
          alt=""
          draggable={false}
          style={{ width: ghost.size, height: ghost.size }}
        />
      )}
    </div>
  )
}
