import type { Dispatch, FC, SetStateAction } from 'react'
import { useCallback, useRef } from 'react'
import type { Board, Position, Tile } from '@logic/board'
import { checkIfPositionsMatch } from '@logic/board'
import type { Color, Move, Piece } from '@logic/pieces'
import { checkIfSelectedPieceCanMoveHere, createId } from '@logic/pieces'
import { MeshWrapper } from '@models/index'
import { PieceModel } from '@models/PieceModel'
import { TileComponent } from '@models/Tile'
import { CaptureBurst } from '@models/CaptureBurst'
import { animated, useSpring } from '@react-spring/three'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { BoardTheme, PieceSetTheme, RoomTheme } from '@/lib/themes'
import { setLiveView } from '@/lib/viewDebug'
import { positionKey } from '@/logic/movePreview'
import { useBoardPlay, type GameOver } from '@/components/useBoardPlay'

export type { GameOver }

const ZERO_OFFSET: [number, number, number] = [0, 0, 0]

type ThreePointerEvent = {
  stopPropagation: () => void
  nativeEvent: PointerEvent
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
  /** Browse modes: drag whichever side is to move, not only your color. */
  playBothSides?: boolean
  /** Return false to reject a player move attempt (e.g. drill mode). */
  validateMove?: (move: Move) => boolean
  /**
   * Analysis scrub. Pass the clicked move so both of its squares light up.
   * `null` means the start position (no move). Omit it during live play.
   */
  highlightMove?: { from: Position; to: Position } | null
  /** Rotate every piece model to face the active player (two-player auto flip). */
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
  playBothSides = false,
  validateMove,
  highlightMove,
  pieceYaw = 0,
}) => {
  const {
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
    setHoveredDestKey,
    handlePreviewHover,
    checkedKingPos,
    oppKingPos,
    showOppCheckRing,
    captureBurst,
    startPieceDrag,
    endDrag: endDragMove,
    cancelDrag,
    finishMovingPiece,
  } = useBoardPlay({
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
  })

  const controlsRef = useRef<OrbitControlsImpl>(null)
  const boardGroupRef = useRef<THREE.Group>(null)
  const dragBoardRef = useRef<{ x: number; z: number } | null>(null)
  const lastDragSquareRef = useRef<Position | null>(null)
  const endDragRef = useRef<() => void>(() => {})
  const dragListenersRef = useRef<{
    onUp: () => void
    onCancel: () => void
  } | null>(null)
  const movesRef = useRef(moves)
  movesRef.current = moves

  const { camera, pointer, raycaster, gl } = useThree()
  const hitPoint = useRef(new THREE.Vector3()).current
  const planeNormal = useRef(new THREE.Vector3(0, 1, 0)).current
  const planePoint = useRef(new THREE.Vector3()).current
  const dragPlane = useRef(new THREE.Plane()).current

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
    // Prefer the square tracked while dragging — R3F pointer can be stale on window pointerup.
    const local = raycastBoardLocal()
    const sq = lastDragSquareRef.current ?? (local ? squareFromLocal(local) : null)
    lastDragSquareRef.current = null
    dragBoardRef.current = null
    if (controlsRef.current) controlsRef.current.enabled = true
    endDragMove(sq)
  }, [detachDragListeners, endDragMove, raycastBoardLocal, squareFromLocal])

  endDragRef.current = endDrag

  // Board-local height of each piece's grab point. The mesh in front (the
  // king standing closer to the camera) can cover a pawn's body, so a drag
  // aimed at the pawn used to start on the king and then go nowhere.
  const GRAB_Y: Record<string, number> = {
    pawn: 0.95,
    knight: 1.2,
    bishop: 1.4,
    rook: 1.15,
    queen: 1.75,
    king: 1.9,
  }

  const pieceClosestToPointer = (clientX: number, clientY: number): Tile | null => {
    const group = boardGroupRef.current
    if (!group) return null
    const rect = gl.domElement.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    group.updateWorldMatrix(true, true)
    camera.updateMatrixWorld()
    const v = new THREE.Vector3()
    const projectAt = (file: number, rank: number, gy: number) => {
      v.set(file, gy, rank)
      group.localToWorld(v)
      v.project(camera)
      return {
        x: (v.x * 0.5 + 0.5) * rect.width,
        y: (-v.y * 0.5 + 0.5) * rect.height,
      }
    }
    let best: { tile: Tile; d2: number; gy: number } | null = null
    for (const row of board) {
      for (const tile of row) {
        const piece = tile.piece
        if (!piece) continue
        const gy = GRAB_Y[piece.type] ?? 1
        const p = projectAt(tile.position.x, tile.position.y, gy)
        const d2 = (p.x - x) ** 2 + (p.y - y) ** 2
        if (!best || d2 < best.d2) best = { tile, d2, gy }
      }
    }
    if (!best?.tile.piece) return null
    const here = projectAt(best.tile.position.x, best.tile.position.y, best.gy)
    const step = best.tile.position.x < 7 ? 1 : -1
    const beside = projectAt(
      best.tile.position.x + step,
      best.tile.position.y,
      best.gy,
    )
    const square = Math.hypot(beside.x - here.x, beside.y - here.y)
    const limit = Math.max(16, square * 0.62)
    if (best.d2 > limit * limit) return null
    return best.tile
  }

  const beginDrag = (e: ThreePointerEvent, tile: Tile) => {
    e.stopPropagation()
    let picked =
      pieceClosestToPointer(e.nativeEvent.clientX, e.nativeEvent.clientY) ??
      tile
    if (!startPieceDrag(picked)) {
      if (picked === tile || !startPieceDrag(tile)) return
      picked = tile
    }
    lastDragSquareRef.current = {
      x: picked.position.x,
      y: picked.position.y,
    }
    dragBoardRef.current = {
      x: picked.position.x,
      z: picked.position.y,
    }
    if (controlsRef.current) controlsRef.current.enabled = false

    // Attach immediately — a useEffect listener misses quick click-releases.
    detachDragListeners()
    const onUp = () => endDragRef.current()
    const onCancel = () => {
      detachDragListeners()
      lastDragSquareRef.current = null
      dragBoardRef.current = null
      cancelDrag()
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
        touches={{
          ONE:
            orbitDragMode === 'move'
              ? (-1 as THREE.TOUCH)
              : orbitDragMode === 'pan'
                ? THREE.TOUCH.PAN
                : THREE.TOUCH.ROTATE,
          TWO:
            orbitDragMode === 'move'
              ? (-1 as THREE.TOUCH)
              : THREE.TOUCH.DOLLY_PAN,
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
            !!lastMoveSquares &&
            (checkIfPositionsMatch(tile.position, lastMoveSquares.from) ||
              checkIfPositionsMatch(tile.position, lastMoveSquares.to))
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
                  rotationY={pieceYaw}
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
                    pieceYaw={pieceYaw}
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
