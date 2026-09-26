import type { Dispatch, FC, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Board, Position, Tile } from '@logic/board'
import { checkIfPositionsMatch, copyBoard } from '@logic/board'
import type { Color, GameOverType, Move, Piece } from '@logic/pieces'
import {
  checkIfSelectedPieceCanMoveHere,
  createId,
  detectGameOver,
  findKingPosition,
  getTile,
  isKingInCheck,
  movesForPiece,
  oppositeColor,
  shouldPromotePawn,
} from '@logic/pieces'
import { isPawn } from '@logic/pieces/pawn'
import { isKing } from '@logic/pieces/king'
import { isRook } from '@logic/pieces/rook'
import { MeshWrapper } from '@models/index'
import { PieceModel } from '@models/PieceModel'
import { TileComponent } from '@models/Tile'
import { FrequencyArrows } from '@models/FrequencyArrows'
import type { FrequencyArrow } from '@/lib/replyArrows'
import { CaptureBurst } from '@models/CaptureBurst'
import { animated, useSpring } from '@react-spring/three'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useGameState } from '@/state/game'
import type { BoardTheme, PieceSetTheme, RoomTheme } from '@/lib/themes'
import { playSfx } from '@/lib/sfx'
import { setLiveView } from '@/lib/viewDebug'
import type { MovePreview } from '@/logic/movePreview'
import {
  applyMoveOnCopy,
  pieceSafetyMap,
  positionKey,
  previewByDestination,
  tooltipLinesForPreview,
} from '@/logic/movePreview'

const ZERO_OFFSET: [number, number, number] = [0, 0, 0]

type ThreePointerEvent = {
  stopPropagation: () => void
  nativeEvent: PointerEvent
}

export type GameOver = {
  /** checkmate/stalemate from live play; resign/draw from imported PGN. */
  type: GameOverType | 'resign' | 'draw'
  /** Null only for drawn imported games. */
  winner: Color | null
}

export const BoardComponent: FC<{
  selected: Piece | null
  setSelected: (piece: Piece | null) => void
  board: Board
  setBoard: Dispatch<SetStateAction<Board>>
  moves: Move[]
  setMoves: (moves: Move[]) => void
  setGameOver: (gameOver: GameOver | null) => void
  playerColor: Color
  tipFrom?: Position | null
  tipTo?: Position | null
  /** Chessreps-style wrong drill attempt (from/to). */
  wrongFrom?: Position | null
  wrongTo?: Position | null
  pendingEngineMove?: Move | null
  onEngineMoveConsumed?: () => void
  boardTheme: BoardTheme
  pieceSet: PieceSetTheme
  roomTheme: RoomTheme
  boardId?: string
  pieceSetId?: string
  /** Left-drag: move pieces / orbit / screen pan */
  orbitDragMode?: 'move' | 'rotate' | 'pan'
  /** Move-safety cues + threatened-piece rings */
  showMoveIndicators?: boolean
  /** When true, ignore piece clicks / engine animation (imported review). */
  readOnly?: boolean
  /** Return false to reject a player move attempt (e.g. drill mode). */
  validateMove?: (move: Move) => boolean
  /** Opening-tree arrows: more frequent moves are more opaque. */
  frequencyArrows?: FrequencyArrow[]
}> = ({
  selected,
  setSelected,
  board,
  setBoard,
  moves,
  setMoves,
  setGameOver,
  playerColor,
  tipFrom = null,
  tipTo = null,
  wrongFrom = null,
  wrongTo = null,
  pendingEngineMove = null,
  onEngineMoveConsumed,
  boardTheme,
  pieceSet,
  roomTheme,
  boardId = boardTheme.id,
  pieceSetId = pieceSet.id,
  orbitDragMode = 'move',
  showMoveIndicators = true,
  readOnly = false,
  validateMove,
  frequencyArrows = [],
}) => {
  const [lastSelected, setLastSelected] = useState<Tile | null>(null)
  const turn = useGameState((s) => s.turn)
  const setTurn = useGameState((s) => s.setTurn)
  const movingTo = useGameState((s) => s.movingTo)
  const setMovingTo = useGameState((s) => s.setMovingTo)
  const history = useGameState((s) => s.history)
  const addHistory = useGameState((s) => s.addHistory)
  const sfxPlayedForMove = useRef<string | null>(null)
  const [premove, setPremove] = useState<{
    pieceId: string
    from: Position
    to: Position
  } | null>(null)

  const lastOpponentMove = (() => {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].piece.color !== playerColor) return history[i]
    }
    return null
  })()

  const [redLightPosition, setRedLightPosition] = useState<Position>({
    x: 0,
    y: 0,
  })
  const [previewTip, setPreviewTip] = useState<{
    lines: string[]
    x: number
    y: number
  } | null>(null)
  /** Legal dest under pointer while a piece is selected — drives after-move rings. */
  const [hoveredDestKey, setHoveredDestKey] = useState<string | null>(null)

  const movePreviews = useMemo(
    () =>
      showMoveIndicators && selected && moves.length
        ? previewByDestination(board, moves)
        : null,
    [board, moves, selected, showMoveIndicators],
  )

  const safetyBySquare = useMemo(() => {
    if (!showMoveIndicators) return null
    let viewBoard = board
    if (selected && hoveredDestKey) {
      const move = moves.find(
        (m) => positionKey(m.newPosition) === hoveredDestKey,
      )
      if (move) viewBoard = applyMoveOnCopy(board, move)
    }
    return pieceSafetyMap(viewBoard, playerColor)
  }, [board, hoveredDestKey, moves, playerColor, selected, showMoveIndicators])

  useEffect(() => {
    if (!selected || !showMoveIndicators) {
      setPreviewTip(null)
      setHoveredDestKey(null)
    }
  }, [selected, showMoveIndicators])

  useEffect(() => {
    const id = 'move-preview-tooltip'
    if (!previewTip) {
      document.getElementById(id)?.remove()
      return
    }
    let el = document.getElementById(id)
    if (!el) {
      el = document.createElement('div')
      el.id = id
      el.className = 'move-preview-tooltip'
      el.setAttribute('role', 'tooltip')
      document.body.appendChild(el)
    }
    el.style.left = `${previewTip.x + 14}px`
    el.style.top = `${previewTip.y + 14}px`
    el.replaceChildren(
      ...previewTip.lines.map((line) => {
        const row = document.createElement('div')
        row.textContent = line
        return row
      }),
    )
  }, [previewTip])

  useEffect(() => {
    return () => {
      document.getElementById('move-preview-tooltip')?.remove()
    }
  }, [])

  const handlePreviewHover = (
    preview: MovePreview | null,
    clientX: number,
    clientY: number,
    destKey: string | null = null,
  ) => {
    if (!preview) {
      setPreviewTip(null)
      setHoveredDestKey(null)
      return
    }
    if (destKey != null) setHoveredDestKey(destKey)
    setPreviewTip({
      lines: tooltipLinesForPreview(preview),
      x: clientX,
      y: clientY,
    })
  }

  const selectThisPiece = (tile: Tile | null) => {
    if (readOnly) return
    if (!tile?.piece?.type && !selected) {
      setPremove(null)
      return
    }
    if (!tile?.piece) {
      setSelected(null)
      setMoves([])
      setPremove(null)
      return
    }
    if (tile.piece.color !== playerColor) return
    // Keep an in-flight opponent move animating — don't cancel it to pick up.
    if (!movingTo) setMovingTo(null)
    setMoves(
      movesForPiece({ piece: tile.piece, board, propagateDetectCheck: true }),
    )
    setSelected(tile.piece)
    setLastSelected(tile)
    setRedLightPosition(tile.position)
  }

  const controlsRef = useRef<OrbitControlsImpl>(null)
  const boardGroupRef = useRef<THREE.Group>(null)
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)
  const dragPieceIdRef = useRef<string | null>(null)
  const [dragPieceId, setDragPieceId] = useState<string | null>(null)
  const dragBoardRef = useRef<{ x: number; z: number } | null>(null)
  const lastDragSquareRef = useRef<Position | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const movesRef = useRef(moves)
  movesRef.current = moves
  const boardRef = useRef(board)
  boardRef.current = board
  const turnRef = useRef(turn)
  turnRef.current = turn
  const playerColorRef = useRef(playerColor)
  playerColorRef.current = playerColor
  const movingToRef = useRef(movingTo)
  movingToRef.current = movingTo
  const validateMoveRef = useRef(validateMove)
  validateMoveRef.current = validateMove
  const endDragRef = useRef<() => void>(() => {})
  const dragListenersRef = useRef<{
    onUp: () => void
    onCancel: () => void
  } | null>(null)

  const { camera, pointer, raycaster } = useThree()
  const hitPoint = useMemo(() => new THREE.Vector3(), [])
  const planeNormal = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const planePoint = useMemo(() => new THREE.Vector3(), [])
  const dragPlane = useMemo(() => new THREE.Plane(), [])

  const squareFromLocal = useCallback((local: THREE.Vector3): Position | null => {
    const file = Math.round(local.x)
    const rank = Math.round(local.z)
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null
    return { x: file, y: rank }
  }, [])

  const raycastBoardLocal = useCallback((): THREE.Vector3 | null => {
    const group = boardGroupRef.current
    if (!group) return null
    planePoint.set(0, 0.5, 0)
    group.localToWorld(planePoint)
    planeNormal.set(0, 1, 0).transformDirection(group.matrixWorld).normalize()
    dragPlane.setFromNormalAndCoplanarPoint(planeNormal, planePoint)
    raycaster.setFromCamera(pointer, camera)
    if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return null
    return group.worldToLocal(hitPoint.clone())
  }, [camera, dragPlane, hitPoint, planeNormal, planePoint, pointer, raycaster])

  useFrame(() => {
    if (!draggingRef.current) return
    const local = raycastBoardLocal()
    if (!local) return
    dragBoardRef.current = { x: local.x, z: local.z }
    const sq = squareFromLocal(local)
    lastDragSquareRef.current = sq
    const key =
      sq &&
      movesRef.current.some((m) => positionKey(m.newPosition) === positionKey(sq))
        ? positionKey(sq)
        : null
    setHoveredDestKey((prev) => (prev === key ? prev : key))
  })

  const clearSelection = useCallback(() => {
    setSelected(null)
    setMoves([])
    setLastSelected(null)
    // Never clear movingTo here — that would abort an in-flight opponent
    // (or own) piece animation when queueing a premove / deselecting.
  }, [setMoves, setSelected])

  const detachDragListeners = useCallback(() => {
    const listeners = dragListenersRef.current
    if (!listeners) return
    window.removeEventListener('pointerup', listeners.onUp)
    window.removeEventListener('pointercancel', listeners.onCancel)
    dragListenersRef.current = null
  }, [])

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return
    detachDragListeners()
    draggingRef.current = false
    setDragging(false)
    dragPieceIdRef.current = null
    setDragPieceId(null)
    dragBoardRef.current = null
    if (controlsRef.current) controlsRef.current.enabled = true

    // Prefer the square tracked while dragging — R3F pointer can be stale on window pointerup.
    const local = raycastBoardLocal()
    const sq = lastDragSquareRef.current ?? (local ? squareFromLocal(local) : null)
    lastDragSquareRef.current = null
    const piece = selectedRef.current
    const legalMoves = movesRef.current

    if (!piece || !sq) {
      clearSelection()
      setHoveredDestKey(null)
      return
    }

    // Dropped back on origin — cancel (also clears a queued premove).
    if (sq.x === piece.position.x && sq.y === piece.position.y) {
      setPremove(null)
      clearSelection()
      setHoveredDestKey(null)
      return
    }

    const move = legalMoves.find(
      (m) => m.newPosition.x === sq.x && m.newPosition.y === sq.y,
    )
    if (!move) {
      setPremove(null)
      clearSelection()
      setHoveredDestKey(null)
      return
    }

    const destTile = getTile(boardRef.current, sq)
    if (!destTile) {
      clearSelection()
      return
    }

    const validate = validateMoveRef.current
    if (validate && !validate(move)) {
      playSfx('check')
      clearSelection()
      return
    }

    // Opponent's turn (or their piece still settling) → queue a premove.
    // Also queue if an opponent move is still animating even if turn already
    // flipped (shouldn't normally happen, but keep the animation alive).
    const opponentMoving =
      !!movingToRef.current &&
      movingToRef.current.move.piece.color !== playerColorRef.current
    if (turnRef.current !== playerColorRef.current || opponentMoving) {
      setPremove({
        pieceId: piece.getId(),
        from: { ...piece.position },
        to: { ...sq },
      })
      clearSelection()
      setHoveredDestKey(null)
      return
    }

    setPremove(null)
    setMovingTo({ move, tile: destTile })
    setHoveredDestKey(null)
  }, [
    clearSelection,
    detachDragListeners,
    raycastBoardLocal,
    setMovingTo,
    squareFromLocal,
  ])

  endDragRef.current = endDrag

  useEffect(() => {
    if (readOnly || !pendingEngineMove || movingTo) return
    const target = getTile(board, pendingEngineMove.newPosition)
    if (!target) {
      onEngineMoveConsumed?.()
      return
    }
    setMovingTo({ move: pendingEngineMove, tile: target })
    onEngineMoveConsumed?.()
  }, [
    readOnly,
    pendingEngineMove,
    movingTo,
    board,
    onEngineMoveConsumed,
    setMovingTo,
  ])

  // Fire queued premove as soon as it's our turn and the board is idle.
  useEffect(() => {
    if (readOnly || !premove || movingTo || pendingEngineMove) return
    if (turn !== playerColor) return

    let pieceTile: Tile | null = null
    for (const row of board) {
      for (const t of row) {
        if (t.piece?.getId() === premove.pieceId) {
          pieceTile = t
          break
        }
      }
      if (pieceTile) break
    }
    if (!pieceTile?.piece) {
      setPremove(null)
      return
    }

    const legal = movesForPiece({
      piece: pieceTile.piece,
      board,
      propagateDetectCheck: true,
    })
    const match = legal.find(
      (m) =>
        m.newPosition.x === premove.to.x && m.newPosition.y === premove.to.y,
    )
    const dest = match ? getTile(board, premove.to) : null
    if (!match || !dest) {
      setPremove(null)
      return
    }
    if (validateMove && !validateMove(match)) {
      setPremove(null)
      return
    }

    setPremove(null)
    setMovingTo({ move: match, tile: dest })
  }, [
    readOnly,
    premove,
    movingTo,
    pendingEngineMove,
    turn,
    playerColor,
    board,
    validateMove,
    setMovingTo,
  ])

  // SFX when a move animation starts
  useEffect(() => {
    if (!movingTo) {
      sfxPlayedForMove.current = null
      return
    }
    const key = `${movingTo.move.piece.getId()}-${movingTo.move.newPosition.x}-${movingTo.move.newPosition.y}`
    if (sfxPlayedForMove.current === key) return
    sfxPlayedForMove.current = key
    const isCapture =
      movingTo.move.type === 'capture' ||
      movingTo.move.type === 'captureEnPassant' ||
      movingTo.move.type === 'captureKing'
    playSfx(isCapture ? 'capture' : 'move')
  }, [movingTo])

  const finishMovingPiece = (tile: Tile | null) => {
    if (!tile || !movingTo) return
    addHistory({
      board: copyBoard(board),
      to: movingTo.move.newPosition,
      from: movingTo.move.piece.position,
      steps: movingTo.move.steps,
      capture: movingTo.move.capture,
      type: movingTo.move.type,
      piece: movingTo.move.piece,
    })

    const newBoard = copyBoard(board)
    if (!movingTo.move.piece) return
    const fromTile = getTile(newBoard, movingTo.move.piece.position)
    const tileToMoveTo = getTile(newBoard, tile.position)
    if (!fromTile || !tileToMoveTo) return

    if (
      isPawn(fromTile.piece) ||
      isKing(fromTile.piece) ||
      isRook(fromTile.piece)
    ) {
      fromTile.piece = { ...fromTile.piece, hasMoved: true }
    }
    if (isPawn(fromTile.piece) && shouldPromotePawn({ tile })) {
      fromTile.piece.type = `queen`
      fromTile.piece.id = fromTile.piece.id + 1
    }

    if (
      isPawn(fromTile.piece) &&
      movingTo.move.type === `captureEnPassant`
    ) {
      const latestMove = history[history.length - 1]
      if (latestMove) {
        const enPassantTile = newBoard[latestMove.to.y][latestMove.to.x]
        enPassantTile.piece = null
      }
    }

    if (movingTo.move.castling) {
      const { rook, rookNewPosition } = movingTo.move.castling
      const rookTile = newBoard[rook.position.y][rook.position.x]
      const rookTileToMoveTo = newBoard[rookNewPosition.y][rookNewPosition.x]
      if (!isRook(rookTile.piece)) return
      rookTileToMoveTo.piece = {
        ...rookTile.piece,
        hasMoved: true,
        position: rookTileToMoveTo.position,
      }
      rookTile.piece = null
    }

    tileToMoveTo.piece = fromTile.piece
      ? { ...fromTile.piece, position: tile.position }
      : null
    fromTile.piece = null

    setBoard(newBoard)
    setTurn()
    setMovingTo(null)

    // Keep a held piece in-hand across the opponent's (or own) move settle.
    const heldId = draggingRef.current ? dragPieceIdRef.current : null
    if (heldId) {
      for (const row of newBoard) {
        for (const t of row) {
          if (t.piece?.getId() !== heldId) continue
          setSelected(t.piece)
          setLastSelected(t)
          setRedLightPosition(t.position)
          setMoves(
            movesForPiece({
              piece: t.piece,
              board: newBoard,
              propagateDetectCheck: true,
            }),
          )
          return
        }
      }
    }

    setMoves([])
    setSelected(null)
    setLastSelected(null)
  }

  const prevCheckRef = useRef(false)
  const gameOverSfxRef = useRef(false)

  useEffect(() => {
    const gameOverType = detectGameOver(board, turn)
    if (gameOverType) {
      setGameOver({ type: gameOverType, winner: oppositeColor(turn) })
      if (!gameOverSfxRef.current) {
        gameOverSfxRef.current = true
        playSfx('gameOver')
      }
      return
    }
    gameOverSfxRef.current = false
    const inCheck = isKingInCheck(board, turn)
    if (inCheck && !prevCheckRef.current) playSfx('check')
    prevCheckRef.current = inCheck
  }, [board, turn, setGameOver])

  const beginDrag = (e: ThreePointerEvent, tile: Tile) => {
    e.stopPropagation()
    if (readOnly) return
    if (!tile.piece || tile.piece.color !== playerColor) return
    // Don't grab a piece that is currently animating a move.
    if (
      movingTo &&
      movingTo.move.piece.getId() === tile.piece.getId()
    ) {
      return
    }
    selectThisPiece(tile)
    draggingRef.current = true
    dragPieceIdRef.current = tile.piece.getId()
    setDragPieceId(tile.piece.getId())
    setDragging(true)
    lastDragSquareRef.current = {
      x: tile.position.x,
      y: tile.position.y,
    }
    dragBoardRef.current = {
      x: tile.position.x,
      z: tile.position.y,
    }
    if (controlsRef.current) controlsRef.current.enabled = false

    // Attach immediately — a useEffect listener misses quick click-releases.
    detachDragListeners()
    const onUp = () => endDragRef.current()
    const onCancel = () => {
      detachDragListeners()
      draggingRef.current = false
      setDragging(false)
      dragPieceIdRef.current = null
      setDragPieceId(null)
      dragBoardRef.current = null
      lastDragSquareRef.current = null
      clearSelection()
      if (controlsRef.current) controlsRef.current.enabled = true
    }
    dragListenersRef.current = { onUp, onCancel }
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const { intensity } = useSpring({
    intensity: selected ? 0.35 : 0,
    config: { tension: 400, friction: 28 },
  })

  const kingInCheck = isKingInCheck(board, turn)
  const checkedKingPos = kingInCheck ? findKingPosition(board, turn) : null
  const oppKingPos = findKingPosition(board, oppositeColor(playerColor))
  const hoveredPreview =
    hoveredDestKey && movePreviews
      ? (movePreviews.get(hoveredDestKey) ?? null)
      : null
  const showOppCheckRing = !!hoveredPreview?.givesCheck

  const captureBurst =
    movingTo?.move.capture != null
      ? {
          key: createId(movingTo.move.capture),
          position: [
            movingTo.move.capture.position.x,
            0.5,
            movingTo.move.capture.position.y,
          ] as [number, number, number],
        }
      : null

  const s = pieceSet.wrapperScale
  const materialVariant =
    pieceSet.kind === 'textured' || pieceSet.kind === 'flat'
      ? 'textured'
      : 'metal'

  const minPolar = roomTheme.minPolarAngle ?? Math.PI / 6
  const maxPolar = roomTheme.maxPolarAngle ?? Math.PI / 2.15
  const minDist = roomTheme.minDistance ?? 7
  const maxDist = roomTheme.maxDistance ?? 28
  // Stable fallback — a fresh [0,0,0] each render makes OrbitControls reset target.
  const target = roomTheme.boardOffset ?? ZERO_OFFSET

  return (
    <group ref={boardGroupRef} position={[-3.5, -0.5, -3.5]}>
      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={target}
        maxDistance={maxDist}
        minDistance={minDist}
        maxPolarAngle={maxPolar}
        minPolarAngle={minPolar}
        enableZoom={!dragging}
        enablePan={!dragging && orbitDragMode !== 'move'}
        enableRotate={!dragging}
        enabled={!dragging}
        screenSpacePanning
        mouseButtons={{
          LEFT:
            orbitDragMode === 'move'
              ? (-1 as THREE.MOUSE)
              : orbitDragMode === 'pan'
                ? THREE.MOUSE.PAN
                : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT:
            orbitDragMode === 'move'
              ? THREE.MOUSE.ROTATE
              : orbitDragMode === 'pan'
                ? THREE.MOUSE.ROTATE
                : THREE.MOUSE.PAN,
        }}
      />
      <ViewProbe
        roomId={roomTheme.id}
        boardId={boardId}
        pieceSetId={pieceSetId}
        boardOffset={target}
        minDistance={minDist}
        maxDistance={maxDist}
        minPolarAngle={minPolar}
        maxPolarAngle={maxPolar}
      />
      <pointLight
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0002}
        castShadow
        position={[3.5, 10, 3.5]}
        intensity={0.7}
        color="#ffe0ec"
      />
      <hemisphereLight intensity={0.55} color="#ffa4a4" groundColor="#d886b7" />
      {selected && (
        <animated.pointLight
          intensity={intensity}
          color="red"
          position={[redLightPosition.x, 1, redLightPosition.y]}
        />
      )}
      {captureBurst && (
        <CaptureBurst
          key={captureBurst.key}
          burstKey={captureBurst.key}
          position={captureBurst.position}
          active
        />
      )}
      <FrequencyArrows arrows={frequencyArrows} />
      {board.map((row, i) =>
        row.map((tile, j) => {
          const bg = `${(i + j) % 2 === 0 ? `white` : `black`}`
          const isSelected =
            tile.piece && selected?.getId() === tile.piece.getId()
          const canMoveHere = checkIfSelectedPieceCanMoveHere({
            tile,
            moves,
            selected,
          })
          const tileId = tile.piece?.getId()
          const pieceIsBeingReplaced =
            movingTo?.move.piece && tile.piece && movingTo?.move.capture
              ? tileId === createId(movingTo.move.capture)
              : false
          const rookCastled = movingTo?.move.castling?.rook
          const isBeingCastled =
            rookCastled && createId(rookCastled) === tile.piece?.getId()

          const isTip =
            checkIfPositionsMatch(tile.position, tipFrom) ||
            checkIfPositionsMatch(tile.position, tipTo)
          const isCheck = checkIfPositionsMatch(tile.position, checkedKingPos)
          const isLastMove =
            !!lastOpponentMove &&
            (checkIfPositionsMatch(tile.position, lastOpponentMove.from) ||
              checkIfPositionsMatch(tile.position, lastOpponentMove.to))
          const isWrongAttempt =
            checkIfPositionsMatch(tile.position, wrongFrom) ||
            checkIfPositionsMatch(tile.position, wrongTo)
          const isPremove =
            !!premove &&
            (checkIfPositionsMatch(tile.position, premove.from) ||
              checkIfPositionsMatch(tile.position, premove.to))

          const pieceId = tile.piece
            ? `${tile.piece.type}-${tile.piece.color}-${tile.piece.id}-${j}-${i}-${pieceSet.id}`
            : `empty-${j}-${i}`

          return (
            <group key={`${j}-${i}`}>
              <TileComponent
                color={bg}
                mode={boardTheme.tileMode}
                squareLight={boardTheme.squares?.light}
                squareDark={boardTheme.squares?.dark}
                squareMetalness={boardTheme.squareMetalness}
                squareRoughness={boardTheme.squareRoughness}
                position={[j, 0.25, i]}
                canMoveHere={canMoveHere?.newPosition ?? null}
                isTip={isTip}
                isCheck={isCheck}
                isLastMove={isLastMove}
                isWrongAttempt={isWrongAttempt}
                isPremove={isPremove}
                pieceSafety={
                  safetyBySquare?.get(positionKey(tile.position)) ?? null
                }
                isOppCheckPreview={
                  showOppCheckRing &&
                  checkIfPositionsMatch(tile.position, oppKingPos)
                }
                movePreview={
                  canMoveHere
                    ? (movePreviews?.get(
                        positionKey(canMoveHere.newPosition),
                      ) ?? null)
                    : null
                }
                onPreviewHover={handlePreviewHover}
              />
              {tile.piece && (
                <MeshWrapper
                  key={pieceId}
                  position={[j, 0.5, i]}
                  scale={[s, s, s]}
                  meshScale={pieceSet.meshScale}
                  materialVariant={materialVariant}
                  color={tile.piece.color}
                  onPointerDown={(e) => beginDrag(e, tile)}
                  isSelected={!!isSelected}
                  isDragging={dragPieceId === tile.piece.getId()}
                  dragBoardRef={dragBoardRef}
                  homeSquare={{ x: j, z: i }}
                  wasSelected={
                    lastSelected
                      ? lastSelected?.piece?.getId() === tile.piece.getId()
                      : false
                  }
                  canMoveHere={canMoveHere?.newPosition ?? null}
                  movePreview={
                    canMoveHere
                      ? (movePreviews?.get(
                          positionKey(canMoveHere.newPosition),
                        ) ?? null)
                      : null
                  }
                  onPreviewHover={handlePreviewHover}
                  movingTo={
                    checkIfPositionsMatch(
                      tile.position,
                      movingTo?.move.piece?.position,
                    ) && movingTo
                      ? movingTo.move.steps
                      : isBeingCastled
                        ? (movingTo?.move.castling?.rookSteps ?? null)
                        : null
                  }
                  pieceIsBeingReplaced={!!pieceIsBeingReplaced}
                  finishMovingPiece={() =>
                    isBeingCastled
                      ? null
                      : finishMovingPiece(movingTo?.tile ?? null)
                  }
                >
                  <PieceModel
                    kind={tile.piece.type}
                    pieceSet={pieceSet}
                    color={tile.piece.color}
                  />
                </MeshWrapper>
              )}
            </group>
          )
        }),
      )}
    </group>
  )
}

/** Samples live camera/orbit into viewDebug for the Dump view button. */
function ViewProbe({
  roomId,
  boardId,
  pieceSetId,
  boardOffset,
  minDistance,
  maxDistance,
  minPolarAngle,
  maxPolarAngle,
}: {
  roomId: string
  boardId: string
  pieceSetId: string
  boardOffset: [number, number, number]
  minDistance: number
  maxDistance: number
  minPolarAngle: number
  maxPolarAngle: number
}) {
  const { camera, controls } = useThree()
  const targetVec = useRef(new THREE.Vector3())
  useFrame(() => {
    const c = controls as
      | {
          target?: THREE.Vector3
          getDistance?: () => number
          getPolarAngle?: () => number
          getAzimuthalAngle?: () => number
        }
      | null
    const target = c?.target
    const cameraTarget: [number, number, number] = target
      ? [target.x, target.y, target.z]
      : boardOffset
    targetVec.current.set(...cameraTarget)
    const fov =
      'fov' in camera && typeof camera.fov === 'number' ? camera.fov : 40
    setLiveView({
      roomId,
      boardId,
      pieceSetId,
      boardOffset,
      cameraPosition: camera.position.toArray() as [number, number, number],
      cameraTarget,
      cameraFov: fov,
      distance: c?.getDistance?.() ?? camera.position.distanceTo(targetVec.current),
      polarAngle: c?.getPolarAngle?.() ?? 0,
      azimuthAngle: c?.getAzimuthalAngle?.() ?? 0,
      minDistance,
      maxDistance,
      minPolarAngle,
      maxPolarAngle,
    })
  })
  return null
}
