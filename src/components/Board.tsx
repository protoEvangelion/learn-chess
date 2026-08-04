import type { Dispatch, FC, SetStateAction } from 'react'
import { useEffect, useState } from 'react'
import type { Board, Position, Tile } from '@logic/board'
import { checkIfPositionsMatch, copyBoard } from '@logic/board'
import type { Color, GameOverType, Move, Piece } from '@logic/pieces'
import {
  checkIfSelectedPieceCanMoveHere,
  createId,
  detectGameOver,
  getTile,
  movesForPiece,
  oppositeColor,
  shouldPromotePawn,
} from '@logic/pieces'
import { isPawn } from '@logic/pieces/pawn'
import { isKing } from '@logic/pieces/king'
import { isRook } from '@logic/pieces/rook'
import { BishopComponent } from '@models/Bishop'
import type { ModelProps } from '@models/index'
import { MeshWrapper } from '@models/index'
import { KingComponent } from '@models/King'
import { KnightComponent } from '@models/Knight'
import { PawnModel } from '@models/Pawn'
import { QueenComponent } from '@models/Queen'
import { RookComponent } from '@models/Rook'
import { TileComponent } from '@models/Tile'
import { animated, useSpring } from '@react-spring/three'
import { OrbitControls } from '@react-three/drei'
import { type MovingTo, useGameState } from '@/state/game'

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
}) => {
  const [lastSelected, setLastSelected] = useState<Tile | null>(null)
  const turn = useGameState((s) => s.turn)
  const setTurn = useGameState((s) => s.setTurn)
  const movingTo = useGameState((s) => s.movingTo)
  const setMovingTo = useGameState((s) => s.setMovingTo)
  const history = useGameState((s) => s.history)
  const addHistory = useGameState((s) => s.addHistory)

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
      return
    }
    if (tile.piece.color !== playerColor) return
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

  useEffect(() => {
    const gameOverType = detectGameOver(board, turn)
    if (gameOverType) {
      setGameOver({ type: gameOverType, winner: oppositeColor(turn) })
    }
  }, [board, turn, setGameOver])

  const startMovingPiece = (e: ThreeMouseEvent, tile: Tile, nextTile: Move) => {
    e.stopPropagation()
    const newMovingTo: MovingTo = { move: nextTile, tile }
    setMovingTo(newMovingTo)
  }

  const { intensity } = useSpring({
    intensity: selected ? 0.35 : 0,
  })

  return (
    <group position={[-3.5, -0.5, -3.5]}>
      <OrbitControls
        maxDistance={25}
        minDistance={7}
        enableZoom
        enablePan={false}
      />
      <pointLight
        shadow-mapSize={[2048, 2048]}
        castShadow
        position={[3.5, 10, 3.5]}
        intensity={0.65}
        color="#ffe0ec"
      />
      <hemisphereLight intensity={0.5} color="#ffa4a4" groundColor="#d886b7" />
      <animated.pointLight
        intensity={intensity}
        color="red"
        position={[redLightPosition.x, 1, redLightPosition.y]}
      />
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

          const handleClick = (e: ThreeMouseEvent) => {
            if (movingTo) return
            if (turn !== playerColor) return
            const tileContainsOtherPlayersPiece =
              tile.piece && tile.piece?.color !== turn
            if (tileContainsOtherPlayersPiece && !canMoveHere) {
              setSelected(null)
              return
            }
            canMoveHere
              ? startMovingPiece(e, tile, canMoveHere)
              : selectThisPiece(e, tile)
          }

          const props: ModelProps = {
            position: [j, 0.5, i],
            scale: [0.15, 0.15, 0.15],
            color: tile.piece?.color || `white`,
            onClick: handleClick,
            isSelected: !!isSelected,
            wasSelected: lastSelected
              ? lastSelected?.piece?.getId() === tile.piece?.getId()
              : false,
            canMoveHere: canMoveHere?.newPosition ?? null,
            movingTo:
              checkIfPositionsMatch(
                tile.position,
                movingTo?.move.piece?.position,
              ) && movingTo
                ? movingTo.move.steps
                : isBeingCastled
                  ? (movingTo?.move.castling?.rookSteps ?? null)
                  : null,
            pieceIsBeingReplaced: !!pieceIsBeingReplaced,
            finishMovingPiece: () =>
              isBeingCastled ? null : finishMovingPiece(movingTo?.tile ?? null),
          }

          const pieceId = tile.piece?.getId() ?? `empty-${j}-${i}`

          return (
            <group key={`${j}-${i}`}>
              <TileComponent
                color={bg}
                position={[j, 0.25, i]}
                onClick={handleClick}
                canMoveHere={canMoveHere?.newPosition ?? null}
                isTip={isTip}
              />
              <MeshWrapper key={pieceId} {...props}>
                {tile.piece?.type === `pawn` && <PawnModel />}
                {tile.piece?.type === `rook` && <RookComponent />}
                {tile.piece?.type === `knight` && <KnightComponent />}
                {tile.piece?.type === `bishop` && <BishopComponent />}
                {tile.piece?.type === `queen` && <QueenComponent />}
                {tile.piece?.type === `king` && <KingComponent />}
              </MeshWrapper>
            </group>
          )
        }),
      )}
    </group>
  )
}
