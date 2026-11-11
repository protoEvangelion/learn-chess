import type { Dispatch, FC, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import { useRef, useState } from 'react'
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

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const DARK = '#769656'
const LIGHT = '#eeeed2'
const LAST_DARK = '#baca2b'
const LAST_LIGHT = '#f6f669'

const DRAG_SLOP = 5

function spriteSrc(type: PieceType, color: Color) {
  return `/assets/pieces-2d/${type}-${color === 'white' ? 'w' : 'b'}.svg`
}

function algebraic(pos: Position) {
  return `${FILES[pos.x]}${8 - pos.y}`
}

type DragSession = {
  pointerId: number
  x: number
  y: number
  moved: boolean
  reclick: boolean
  type: PieceType
  color: Color
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
  const dragSession = useRef<DragSession | null>(null)
  const [ghost, setGhost] = useState<{
    x: number
    y: number
    type: PieceType
    color: Color
    size: number
  } | null>(null)

  const flipped = seat === 'black'

  const squareFromClient = (clientX: number, clientY: number): Position | null => {
    const el = boardRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null
    const col = Math.min(7, Math.floor((x / rect.width) * 8))
    const row = Math.min(7, Math.floor((y / rect.height) * 8))
    return {
      x: flipped ? 7 - col : col,
      y: flipped ? 7 - row : row,
    }
  }

  const hoverSquare = (clientX: number, clientY: number) => {
    const sq = squareFromClient(clientX, clientY)
    const key =
      sq && moves.some((m) => positionKey(m.newPosition) === positionKey(sq))
        ? positionKey(sq)
        : null
    play.setHoveredDestKey((prev) => (prev === key ? prev : key))
    if (!key || !play.movePreviews) {
      play.handlePreviewHover(null, 0, 0, null)
      return
    }
    const preview = play.movePreviews.get(key) ?? null
    play.handlePreviewHover(preview, clientX, clientY, key)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, tile: Tile) => {
    if (e.button !== 0) return
    if (readOnly) return
    const reclick = !!tile.piece && selected?.getId() === tile.piece.getId()
    const started = play.startPieceDrag(tile)
    if (started && tile.piece) {
      dragSession.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved: false,
        reclick,
        type: tile.piece.type,
        color: tile.piece.color,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (selected) play.commitSquare(tile.position)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragSession.current
    if (!session || session.pointerId !== e.pointerId) return
    if (!session.moved && Math.hypot(e.clientX - session.x, e.clientY - session.y) > DRAG_SLOP) {
      session.moved = true
    }
    if (!session.moved) return
    const rect = boardRef.current?.getBoundingClientRect()
    setGhost({
      x: e.clientX,
      y: e.clientY,
      type: session.type,
      color: session.color,
      size: rect ? rect.width / 8 : 64,
    })
    hoverSquare(e.clientX, e.clientY)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragSession.current
    if (!session || session.pointerId !== e.pointerId) return
    dragSession.current = null
    setGhost(null)
    if (!session.moved) {
      play.releaseDrag()
      if (session.reclick) play.clearSelection()
      return
    }
    play.endDrag(squareFromClient(e.clientX, e.clientY))
  }

  const onPointerCancel = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragSession.current
    if (!session || session.pointerId !== e.pointerId) return
    dragSession.current = null
    setGhost(null)
    play.cancelDrag()
  }

  return (
    <div className="board-2d-wrap">
      <div
        ref={boardRef}
        className="board-2d"
        role="grid"
        aria-label={
          flipped
            ? 'Chess board, Black at the bottom'
            : 'Chess board, White at the bottom'
        }
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
                }}
                onPointerDown={(e) => onPointerDown(e, tile)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                onPointerEnter={(e) => {
                  if (dragSession.current?.moved || !canMoveHere || !preview) return
                  play.handlePreviewHover(
                    preview,
                    e.clientX,
                    e.clientY,
                    positionKey(canMoveHere.newPosition),
                  )
                }}
                onPointerLeave={() => {
                  if (dragSession.current?.moved) return
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
      {ghost && (
        <img
          className="board-2d-ghost"
          src={spriteSrc(ghost.type, ghost.color)}
          alt=""
          draggable={false}
          style={{
            left: ghost.x,
            top: ghost.y,
            width: ghost.size,
            height: ghost.size,
            transform: pieceYaw ? `rotate(${pieceYaw}rad)` : undefined,
          }}
        />
      )}
    </div>
  )
}
