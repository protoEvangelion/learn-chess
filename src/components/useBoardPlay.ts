import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Board, Position, Tile } from '@logic/board'
import { copyBoard } from '@logic/board'
import type { Color, GameOverType, Move, Piece } from '@logic/pieces'
import {
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
import { useGameState, type MovingTo } from '@/state/game'
import { playSfx } from '@/lib/sfx'
import type { MovePreview } from '@/logic/movePreview'
import {
  applyMoveOnCopy,
  pieceSafetyMap,
  positionKey,
  previewByDestination,
  tooltipLinesForPreview,
} from '@/logic/movePreview'

export type GameOver = {
  /** checkmate/stalemate from live play; resign/draw from imported PGN. */
  type: GameOverType | 'resign' | 'draw'
  /** Null only for drawn imported games. */
  winner: Color | null
}

/** One in-flight move object is applied once, even if Strict Mode runs effects twice. */
const finishedMoves = new WeakSet<MovingTo>()

export type BoardPlayProps = {
  selected: Piece | null
  setSelected: (piece: Piece | null) => void
  board: Board
  setBoard: Dispatch<SetStateAction<Board>>
  moves: Move[]
  setMoves: (moves: Move[]) => void
  setGameOver: (gameOver: GameOver | null) => void
  playerColor: Color
  pendingEngineMove?: Move | null
  onEngineMoveConsumed?: () => void
  showMoveIndicators?: boolean
  readOnly?: boolean
  playBothSides?: boolean
  validateMove?: (move: Move) => boolean
  highlightMove?: { from: Position; to: Position } | null
  /**
   * Flat board has no mesh animation. Settle `movingTo` as soon as it is set
   * so a view switch cannot leave a move hanging in the air.
   */
  autoSettle?: boolean
}

export function useBoardPlay({
  selected,
  setSelected,
  board,
  setBoard,
  moves,
  setMoves,
  setGameOver,
  playerColor,
  pendingEngineMove = null,
  onEngineMoveConsumed,
  showMoveIndicators = true,
  readOnly = false,
  playBothSides = false,
  validateMove,
  highlightMove,
  autoSettle = false,
}: BoardPlayProps) {
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

  // Live play marks the opponent's last reply. Analysis passes the clicked
  // move instead — including your own moves, and not a later move in the game.
  const lastMoveSquares =
    highlightMove !== undefined
      ? highlightMove
      : (() => {
          // Two-player / free play: both colors are yours, so mark the last
          // move whoever made it. Against the computer, mark only its reply.
          if (playBothSides) return history[history.length - 1] ?? null
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
    return pieceSafetyMap(viewBoard, playBothSides ? turn : playerColor)
  }, [
    board,
    hoveredDestKey,
    moves,
    playBothSides,
    playerColor,
    selected,
    showMoveIndicators,
    turn,
  ])

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

  const movesRef = useRef(moves)
  movesRef.current = moves
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const boardRef = useRef(board)
  boardRef.current = board
  const turnRef = useRef(turn)
  turnRef.current = turn
  const playerColorRef = useRef(playerColor)
  playerColorRef.current = playerColor
  const playBothSidesRef = useRef(playBothSides)
  playBothSidesRef.current = playBothSides
  const movingToRef = useRef(movingTo)
  movingToRef.current = movingTo
  const validateMoveRef = useRef(validateMove)
  validateMoveRef.current = validateMove

  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)
  const dragPieceIdRef = useRef<string | null>(null)
  const [dragPieceId, setDragPieceId] = useState<string | null>(null)

  const publishMoves = useCallback(
    (next: Move[]) => {
      movesRef.current = next
      setMoves(next)
    },
    [setMoves],
  )

  const selectThisPiece = useCallback(
    (tile: Tile | null) => {
      if (readOnly) return
      if (!tile?.piece?.type && !selectedRef.current) {
        setPremove(null)
        return
      }
      if (!tile?.piece) {
        setSelected(null)
        selectedRef.current = null
        publishMoves([])
        setPremove(null)
        return
      }
      const sideToMove = playBothSidesRef.current
        ? turnRef.current
        : playerColorRef.current
      if (tile.piece.color !== sideToMove) return
      // Keep an in-flight opponent move animating — don't cancel it to pick up.
      if (!movingToRef.current) setMovingTo(null)
      const nextMoves = movesForPiece({
        piece: tile.piece,
        board: boardRef.current,
        propagateDetectCheck: true,
      })
      publishMoves(nextMoves)
      setSelected(tile.piece)
      selectedRef.current = tile.piece
      setLastSelected(tile)
      setRedLightPosition(tile.position)
    },
    [publishMoves, readOnly, setMovingTo, setSelected],
  )

  const clearSelection = useCallback(() => {
    setSelected(null)
    selectedRef.current = null
    publishMoves([])
    setLastSelected(null)
    // Never clear movingTo here — that would abort an in-flight opponent
    // (or own) piece animation when queueing a premove / deselecting.
  }, [publishMoves, setSelected])

  const clearDragFlags = useCallback(() => {
    draggingRef.current = false
    setDragging(false)
    dragPieceIdRef.current = null
    setDragPieceId(null)
  }, [])

  const commitSquare = useCallback(
    (sq: Position | null) => {
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
      const sideToMove = playBothSidesRef.current
        ? turnRef.current
        : playerColorRef.current
      const opponentMoving =
        !!movingToRef.current &&
        movingToRef.current.move.piece.color !== sideToMove
      if (turnRef.current !== sideToMove || opponentMoving) {
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
    },
    [clearSelection, setMovingTo],
  )

  const startPieceDrag = useCallback(
    (tile: Tile): boolean => {
      if (readOnly) return false
      const sideToMove = playBothSidesRef.current
        ? turnRef.current
        : playerColorRef.current
      if (!tile.piece || tile.piece.color !== sideToMove) return false
      if (
        movingToRef.current &&
        movingToRef.current.move.piece.getId() === tile.piece.getId()
      ) {
        return false
      }
      selectThisPiece(tile)
      draggingRef.current = true
      dragPieceIdRef.current = tile.piece.getId()
      setDragPieceId(tile.piece.getId())
      setDragging(true)
      return true
    },
    [readOnly, selectThisPiece],
  )

  const endDrag = useCallback(
    (sq: Position | null) => {
      if (!draggingRef.current) return
      clearDragFlags()
      commitSquare(sq)
    },
    [clearDragFlags, commitSquare],
  )

  /** Pointer went down and up without leaving the square — keep the selection. */
  const releaseDrag = useCallback(() => {
    clearDragFlags()
    setHoveredDestKey(null)
  }, [clearDragFlags])

  const cancelDrag = useCallback(() => {
    clearDragFlags()
    setHoveredDestKey(null)
    clearSelection()
  }, [clearDragFlags, clearSelection])

  // Still apply scripted moves while readOnly (e.g. drill danger preview).
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

  const finishMovingPiece = useCallback(
    (tile: Tile | null) => {
      if (!tile || !movingTo) return
      if (finishedMoves.has(movingTo)) return
      finishedMoves.add(movingTo)

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

      if (isPawn(fromTile.piece) && movingTo.move.type === `captureEnPassant`) {
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
            selectedRef.current = t.piece
            setLastSelected(t)
            setRedLightPosition(t.position)
            const nextMoves = movesForPiece({
              piece: t.piece,
              board: newBoard,
              propagateDetectCheck: true,
            })
            publishMoves(nextMoves)
            return
          }
        }
      }

      publishMoves([])
      setSelected(null)
      selectedRef.current = null
      setLastSelected(null)
    },
    [
      addHistory,
      board,
      history,
      movingTo,
      publishMoves,
      setBoard,
      setMovingTo,
      setSelected,
      setTurn,
    ],
  )

  const finishRef = useRef(finishMovingPiece)
  finishRef.current = finishMovingPiece

  useEffect(() => {
    if (!autoSettle || !movingTo) return
    finishRef.current(movingTo.tile)
  }, [autoSettle, movingTo])

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

  const kingInCheck = isKingInCheck(board, turn)
  const checkedKingPos = kingInCheck ? findKingPosition(board, turn) : null
  const oppKingPos = findKingPosition(
    board,
    oppositeColor(playBothSides ? turn : playerColor),
  )
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

  return {
    turn,
    movingTo,
    premove,
    lastSelected,
    lastMoveSquares,
    redLightPosition,
    dragging,
    draggingRef,
    dragPieceId,
    movePreviews,
    safetyBySquare,
    hoveredDestKey,
    setHoveredDestKey,
    handlePreviewHover,
    checkedKingPos,
    oppKingPos,
    showOppCheckRing,
    captureBurst,
    selectThisPiece,
    clearSelection,
    startPieceDrag,
    endDrag,
    releaseDrag,
    cancelDrag,
    commitSquare,
    finishMovingPiece,
  }
}
