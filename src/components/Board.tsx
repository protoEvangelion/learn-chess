import type { Dispatch, FC, SetStateAction } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { CaptureBurst } from '@models/CaptureBurst'
import { animated, useSpring } from '@react-spring/three'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { type MovingTo, useGameState } from '@/state/game'
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

type ThreeMouseEvent = { stopPropagation: () => void }

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
  pendingEngineMove?: Move | null
  onEngineMoveConsumed?: () => void
  boardTheme: BoardTheme
  pieceSet: PieceSetTheme
  roomTheme: RoomTheme
  boardId?: string
  pieceSetId?: string
  /** Left-drag: orbit vs screen pan */
  orbitDragMode?: 'rotate' | 'pan'
  /** Move-safety cues + threatened-piece rings */
  showMoveIndicators?: boolean
  /** When true, ignore piece clicks / engine animation (imported review). */
  readOnly?: boolean
  /** Return false to reject a player move attempt (e.g. drill mode). */
  validateMove?: (move: Move) => boolean
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
  pendingEngineMove = null,
  onEngineMoveConsumed,
  boardTheme,
  pieceSet,
  roomTheme,
  boardId = boardTheme.id,
  pieceSetId = pieceSet.id,
  orbitDragMode = 'rotate',
  showMoveIndicators = true,
  readOnly = false,
  validateMove,
}) => {
  const [lastSelected, setLastSelected] = useState<Tile | null>(null)
  const turn = useGameState((s) => s.turn)
  const setTurn = useGameState((s) => s.setTurn)
  const movingTo = useGameState((s) => s.movingTo)
  const setMovingTo = useGameState((s) => s.setMovingTo)
  const history = useGameState((s) => s.history)
  const addHistory = useGameState((s) => s.addHistory)
  const sfxPlayedForMove = useRef<string | null>(null)

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

  const selectThisPiece = (e: ThreeMouseEvent, tile: Tile | null) => {
    e.stopPropagation()
    if (readOnly) return
    if (turn !== playerColor) return
    if (!tile?.piece?.type && !selected) return
    if (!tile?.piece) {
      setSelected(null)
      setMoves([])
      return
    }
    if (tile.piece.color !== playerColor) return
    // Second click on the same piece cancels selection / move preview
    if (selected && selected.getId() === tile.piece.getId()) {
      setSelected(null)
      setMoves([])
      setMovingTo(null)
      return
    }
    setMovingTo(null)
    setMoves(
      movesForPiece({ piece: tile.piece, board, propagateDetectCheck: true }),
    )
    setSelected(tile.piece)
    setLastSelected(tile)
    setRedLightPosition(tile.position)
  }

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
    setBoard((prev) => {
      const newBoard = copyBoard(prev)
      if (!movingTo.move.piece) return prev
      const selectedTile = getTile(newBoard, movingTo.move.piece.position)
      const tileToMoveTo = getTile(newBoard, tile.position)
      if (!selectedTile || !tileToMoveTo) return prev

      if (
        isPawn(selectedTile.piece) ||
        isKing(selectedTile.piece) ||
        isRook(selectedTile.piece)
      ) {
        selectedTile.piece = { ...selectedTile.piece, hasMoved: true }
      }
      if (isPawn(selectedTile.piece) && shouldPromotePawn({ tile })) {
        selectedTile.piece.type = `queen`
        selectedTile.piece.id = selectedTile.piece.id + 1
      }

      if (
        isPawn(selectedTile.piece) &&
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
        if (!isRook(rookTile.piece)) return prev
        rookTileToMoveTo.piece = {
          ...rookTile.piece,
          hasMoved: true,
          position: rookTileToMoveTo.position,
        }
        rookTile.piece = null
      }

      tileToMoveTo.piece = selectedTile.piece
        ? { ...selectedTile.piece, position: tile.position }
        : null
      selectedTile.piece = null
      return newBoard
    })

    setTurn()
    setMovingTo(null)
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

  const startMovingPiece = (e: ThreeMouseEvent, tile: Tile, nextTile: Move) => {
    e.stopPropagation()
    if (readOnly) return
    if (validateMove && !validateMove(nextTile)) {
      playSfx('check')
      setSelected(null)
      setMoves([])
      return
    }
    const newMovingTo: MovingTo = { move: nextTile, tile }
    setMovingTo(newMovingTo)
  }

  const { intensity } = useSpring({
    intensity: selected ? 0.35 : 0,
    config: { tension: 200, friction: 24 },
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
    <group position={[-3.5, -0.5, -3.5]}>
      <OrbitControls
        makeDefault
        target={target}
        maxDistance={maxDist}
        minDistance={minDist}
        maxPolarAngle={maxPolar}
        minPolarAngle={minPolar}
        enableZoom
        enablePan
        enableRotate
        screenSpacePanning
        mouseButtons={{
          LEFT:
            orbitDragMode === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT:
            orbitDragMode === 'pan' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
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

          const handleClick = (e: ThreeMouseEvent) => {
            if (movingTo) return
            if (turn !== playerColor) return
            const tileContainsOtherPlayersPiece =
              tile.piece && tile.piece?.color !== turn
            if (tileContainsOtherPlayersPiece && !canMoveHere) {
              setSelected(null)
              setMoves([])
              return
            }
            canMoveHere
              ? startMovingPiece(e, tile, canMoveHere)
              : selectThisPiece(e, tile)
          }

          const pieceId = tile.piece
            ? `${tile.piece.type}-${tile.piece.color}-${tile.piece.id}-${j}-${i}-${pieceSet.id}`
            : `empty-${j}-${i}`

          return (
            <group key={`${j}-${i}`}>
              <TileComponent
                color={bg}
                mode={boardTheme.tileMode}
                position={[j, 0.25, i]}
                onClick={handleClick}
                canMoveHere={canMoveHere?.newPosition ?? null}
                isTip={isTip}
                isCheck={isCheck}
                isLastMove={isLastMove}
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
                  onClick={handleClick}
                  isSelected={!!isSelected}
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
