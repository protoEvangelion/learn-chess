import type { Dispatch, FC, SetStateAction } from 'react'
import { useEffect, useRef, useState } from 'react'
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

type ThreeMouseEvent = { stopPropagation: () => void }

export type GameOver = {
  type: GameOverType
  winner: Color
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

  const selectThisPiece = (e: ThreeMouseEvent, tile: Tile | null) => {
    e.stopPropagation()
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
    if (!pendingEngineMove || movingTo) return
    const target = getTile(board, pendingEngineMove.newPosition)
    if (!target) {
      onEngineMoveConsumed?.()
      return
    }
    setMovingTo({ move: pendingEngineMove, tile: target })
    onEngineMoveConsumed?.()
  }, [pendingEngineMove, movingTo, board, onEngineMoveConsumed, setMovingTo])

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
    const newMovingTo: MovingTo = { move: nextTile, tile }
    setMovingTo(newMovingTo)
  }

  const { intensity } = useSpring({
    intensity: selected ? 0.35 : 0,
    config: { tension: 200, friction: 24 },
  })

  const kingInCheck = isKingInCheck(board, turn)
  const checkedKingPos = kingInCheck ? findKingPosition(board, turn) : null

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
    pieceSet.kind === 'textured' ? 'textured' : 'metal'

  const minPolar = roomTheme.minPolarAngle ?? Math.PI / 6
  const maxPolar = roomTheme.maxPolarAngle ?? Math.PI / 2.15
  const minDist = roomTheme.minDistance ?? 7
  const maxDist = roomTheme.maxDistance ?? 28
  const target = roomTheme.boardOffset ?? ([0, 0, 0] as [number, number, number])

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
