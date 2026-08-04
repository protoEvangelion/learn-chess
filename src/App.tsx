import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Environment, Stats } from '@react-three/drei'
import { createBoard } from '@logic/board'
import type { Board } from '@logic/board'
import type { Color, Move, Piece } from '@logic/pieces'
import { getTile, movesForPiece } from '@logic/pieces'
import { BoardComponent, type GameOver } from '@/components/Board'
import { CoachDialog, CoachIconButton } from '@/components/CoachDialog'
import { SettingsDrawer } from '@/components/SettingsDrawer'
import { PixelButton } from '@/components/ui/PixelButton'
import { Border } from '@models/Border'
import { BoardSurface, preloadBoard } from '@models/BoardSurface'
import { RoomScene, preloadRoom } from '@models/RoomScene'
import { preloadPieceSet } from '@models/PieceModel'
import { useGameState } from '@/state/game'
import {
  boardToFen,
  fenToGame,
  pushGameToUrl,
  readFenFromUrl,
  readGameIdFromUrl,
  replaceGameInUrl,
  squareToPosition,
  START_FEN,
  type UrlGameState,
} from '@/lib/fenBridge'
import {
  stockfishOpponent,
  type BestMoveResult,
  type StrengthLevel,
} from '@/lib/stockfishOpponent'
import { EndGameOverlay, outcomeFromResult } from '@/EndGameOverlay'
import { parseCoachTips, type CoachTips } from '@/lib/coachTips'
import {
  getBoardTheme,
  getPieceSet,
  getRoomTheme,
  loadBoardId,
  loadMuted,
  loadPieceSetId,
  loadRoomId,
  loadShowBestMove,
  loadVolume,
} from '@/lib/themes'
import { unlockSfx } from '@/lib/sfx'
import { formatViewForThemes, getLiveView } from '@/lib/viewDebug'
import './App.css'

const STRENGTH_KEY = 'chess-3d:strength'
const COLOR_KEY = 'chess-3d:playerColor'

function loadStrength(): StrengthLevel {
  const raw = Number(localStorage.getItem(STRENGTH_KEY) ?? 3)
  if (raw >= 1 && raw <= 8) return raw as StrengthLevel
  return 3
}

function loadPlayerColor(): Color {
  return localStorage.getItem(COLOR_KEY) === 'black' ? 'black' : 'white'
}

/** Push camera to the active room's preset when the room theme changes. */
function RoomCamera({
  position,
  fov,
  target,
}: {
  position: [number, number, number]
  fov: number
  target: [number, number, number]
}) {
  const { camera } = useThree()
  useEffect(() => {
    camera.position.set(...position)
    if ('fov' in camera) {
      ;(camera as typeof camera & { fov: number }).fov = fov
      ;(
        camera as typeof camera & { updateProjectionMatrix: () => void }
      ).updateProjectionMatrix()
    }
    camera.lookAt(...target)
  }, [camera, position, fov, target])
  return null
}

async function mintGameId(signal?: AbortSignal): Promise<string> {
  const res = await fetch('/api/game-id', { method: 'POST', signal })
  if (!res.ok) throw new Error(`Failed to create gameId (${res.status})`)
  const data = (await res.json()) as { gameId?: string }
  if (!data.gameId) throw new Error('No gameId returned')
  return data.gameId
}

function loadInitialBoard() {
  const fromUrl = readFenFromUrl()
  if (fromUrl) {
    const parsed = fenToGame(fromUrl)
    if (parsed) {
      useGameState.setState({
        turn: parsed.turn,
        history: parsed.history,
        movingTo: null,
      })
      return parsed.board
    }
  }
  return createBoard()
}

export default function App() {
  const [board, setBoard] = useState<Board>(loadInitialBoard)
  const [selected, setSelected] = useState<Piece | null>(null)
  const [moves, setMoves] = useState<Move[]>([])
  const [gameOver, setGameOver] = useState<GameOver | null>(null)
  const [endgameDismissed, setEndgameDismissed] = useState(false)
  const [playerColor, setPlayerColor] = useState<Color>(loadPlayerColor)
  const [strength, setStrength] = useState<StrengthLevel>(loadStrength)
  const [best, setBest] = useState<BestMoveResult | null>(null)
  const [analysisStatus, setAnalysisStatus] = useState<
    'idle' | 'loading' | 'error'
  >('idle')
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [coachTips, setCoachTips] = useState<CoachTips | null>(null)
  const [coachStatus, setCoachStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle',
  )
  const [coachError, setCoachError] = useState<string | null>(null)
  const [tip3Open, setTip3Open] = useState(false)
  const [opponentThinking, setOpponentThinking] = useState(false)
  const [pendingEngineMove, setPendingEngineMove] = useState<Move | null>(null)
  const [gameId, setGameId] = useState<string | null>(() => readGameIdFromUrl())
  const [boardId, setBoardId] = useState(loadBoardId)
  const [pieceSetId, setPieceSetId] = useState(loadPieceSetId)
  const [roomId, setRoomId] = useState(loadRoomId)
  const [muted, setMutedState] = useState(loadMuted)
  const [volume, setVolumeState] = useState(loadVolume)
  const [showBestMove, setShowBestMove] = useState(loadShowBestMove)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [coachOpen, setCoachOpen] = useState(false)
  const skipEngineOnce = useRef(false)
  const coachAbortRef = useRef<AbortController | null>(null)
  const syncingFromUrlRef = useRef(false)
  const urlReadyRef = useRef(false)
  const urlHistoryIndexRef = useRef(0)
  const gameIdRef = useRef<string | null>(gameId)
  gameIdRef.current = gameId
  const [urlHistoryIndex, setUrlHistoryIndex] = useState(0)
  const fpsParentRef = useRef<HTMLDivElement>(null)

  const turn = useGameState((s) => s.turn)
  const resetTurn = useGameState((s) => s.resetTurn)
  const history = useGameState((s) => s.history)
  const resetHistory = useGameState((s) => s.resetHistory)
  const setMovingTo = useGameState((s) => s.setMovingTo)
  const movingTo = useGameState((s) => s.movingTo)

  const fen = useMemo(
    () => boardToFen(board, turn, history),
    [board, turn, history],
  )
  const [fenDraft, setFenDraft] = useState(fen)

  useEffect(() => {
    setFenDraft(fen)
  }, [fen])

  // Ensure a Cursor chat gameId exists in the URL for coach session resume.
  useEffect(() => {
    if (gameId) return
    const controller = new AbortController()
    mintGameId(controller.signal)
      .then((id) => {
        setGameId(id)
        replaceGameInUrl(fen, id, urlHistoryIndexRef.current)
      })
      .catch(() => {
        /* Ask coach will surface errors if mint still fails later */
      })
    return () => controller.abort()
    // fen only used for initial URL write when id arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  useEffect(() => {
    if (!gameId) return
    if (!urlReadyRef.current) {
      urlReadyRef.current = true
      replaceGameInUrl(fen, gameId, 0)
      urlHistoryIndexRef.current = 0
      setUrlHistoryIndex(0)
      return
    }
    if (syncingFromUrlRef.current) {
      syncingFromUrlRef.current = false
      replaceGameInUrl(fen, gameId, urlHistoryIndexRef.current)
      return
    }
    const nextIdx = urlHistoryIndexRef.current + 1
    if (pushGameToUrl(fen, gameId, nextIdx)) {
      urlHistoryIndexRef.current = nextIdx
      setUrlHistoryIndex(nextIdx)
    }
  }, [fen, gameId])

  useEffect(() => {
    if (!gameOver) setEndgameDismissed(false)
  }, [gameOver])

  const applyFen = useCallback((raw: string) => {
    const parsed = fenToGame(raw)
    if (!parsed) return false
    setBoard(parsed.board)
    useGameState.setState({
      turn: parsed.turn,
      history: parsed.history,
      movingTo: null,
    })
    setSelected(null)
    setMoves([])
    setGameOver(null)
    setEndgameDismissed(false)
    setPendingEngineMove(null)
    setBest(null)
    skipEngineOnce.current = false
    return true
  }, [])

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as UrlGameState | null
      const fromUrl = readFenFromUrl() ?? START_FEN
      const idFromUrl = readGameIdFromUrl() ?? state?.gameId ?? gameIdRef.current
      syncingFromUrlRef.current = true
      const idx = typeof state?.idx === 'number' ? state.idx : 0
      urlHistoryIndexRef.current = idx
      setUrlHistoryIndex(idx)
      if (idFromUrl && idFromUrl !== gameIdRef.current) setGameId(idFromUrl)
      applyFen(fromUrl)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [applyFen])

  const showBestArrow = showBestMove || tip3Open
  const tipFrom = showBestArrow && best ? squareToPosition(best.from) : null
  const tipTo = showBestArrow && best ? squareToPosition(best.to) : null

  const endOutcome = outcomeFromResult(gameOver, playerColor)
  const needAnalysis = showBestMove || coachOpen

  // Stockfish best-move analysis (only when arrow toggle or coach is open)
  useEffect(() => {
    if (gameOver) {
      setBest(null)
      return
    }
    if (!needAnalysis) return
    const controller = new AbortController()
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setAnalysisStatus('loading')
      setAnalysisError(null)
      try {
        const result = await stockfishOpponent.getBestMove(
          fen,
          controller.signal,
        )
        if (cancelled) return
        setBest(result)
        setAnalysisStatus('idle')
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError'))
          return
        setBest(null)
        setAnalysisStatus('error')
        setAnalysisError(
          err instanceof Error ? err.message : 'Failed to get best move',
        )
      }
    }, 250)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [fen, gameOver, needAnalysis])

  useEffect(() => {
    coachAbortRef.current?.abort()
    coachAbortRef.current = null
    setCoachTips(null)
    setTip3Open(false)
    setCoachStatus('idle')
    setCoachError(null)
  }, [fen, best?.uci])

  // Opponent Stockfish replies
  useEffect(() => {
    if (gameOver || movingTo || pendingEngineMove) return
    if (turn === playerColor) return
    if (skipEngineOnce.current) {
      skipEngineOnce.current = false
      return
    }

    let cancelled = false
    setOpponentThinking(true)
    const timer = window.setTimeout(async () => {
      try {
        const engineMove = await stockfishOpponent.getMove(fen, strength)
        if (cancelled) return
        const from = squareToPosition(engineMove.from)
        const to = squareToPosition(engineMove.to)
        const pieceTile = getTile(board, from)
        if (!pieceTile?.piece) {
          setOpponentThinking(false)
          return
        }
        const legal = movesForPiece({
          piece: pieceTile.piece,
          board,
          propagateDetectCheck: true,
        })
        const match = legal.find(
          (m) => m.newPosition.x === to.x && m.newPosition.y === to.y,
        )
        if (!match) {
          setOpponentThinking(false)
          return
        }
        setPendingEngineMove(match)
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setOpponentThinking(false)
      }
    }, 400)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      setOpponentThinking(false)
    }
  }, [
    turn,
    playerColor,
    fen,
    strength,
    board,
    gameOver,
    movingTo,
    pendingEngineMove,
  ])

  const askCoach = useCallback(async () => {
    if (!best || coachStatus === 'loading') return
    coachAbortRef.current?.abort()
    const controller = new AbortController()
    coachAbortRef.current = controller
    setCoachStatus('loading')
    setCoachError(null)
    setCoachTips(null)
    setTip3Open(false)

    try {
      let id = gameId
      if (!id) {
        id = await mintGameId(controller.signal)
        setGameId(id)
        replaceGameInUrl(fen, id, urlHistoryIndexRef.current)
      }

      const fullmove = fen.split(/\s+/)[5] ?? '?'
      let moveLabel = `${best.from} → ${best.to}`
      try {
        const { Chess } = await import('chess.js')
        const chess = new Chess(fen)
        const played = chess.move({
          from: best.from,
          to: best.to,
          promotion: best.uci.length > 4 ? best.uci[4] : undefined,
        })
        if (played) moveLabel = `${played.san} (${best.from} → ${best.to})`
      } catch {
        /* keep UCI squares */
      }

      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          fen,
          bestMove: `${best.uci} = ${moveLabel}`,
          from: best.from,
          to: best.to,
          evalLabel: best.evalLabel,
          line: best.line,
          gameId: id,
          plyHint: `about move ${fullmove}, ${turn} to play (${history.length} plies recorded this session)`,
        }),
      })
      if (!res.ok || !res.body) throw new Error(`Explain failed (${res.status})`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assembled = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''
        for (const line of parts) {
          if (!line.startsWith('data:')) continue
          const payload = JSON.parse(line.slice(5).trim()) as {
            type: string
            text?: string
            error?: string
          }
          if (payload.type === 'delta' && payload.text) {
            assembled += payload.text
          } else if (payload.type === 'done') {
            if (payload.text) assembled = payload.text
          } else if (payload.type === 'error') {
            throw new Error(payload.error || 'Explain failed')
          }
        }
      }

      const tips = parseCoachTips(assembled)
      if (!tips) {
        throw new Error('Coach reply was not in the expected tip format')
      }
      setCoachTips(tips)
      setCoachStatus('idle')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setCoachStatus('error')
      setCoachError(err instanceof Error ? err.message : 'Ask coach failed')
    }
  }, [best, coachStatus, fen, gameId, history.length, turn])

  // Auto-start coach tips when the panel opens and analysis is ready
  useEffect(() => {
    if (!coachOpen || gameOver) return
    if (!best || coachTips || coachStatus !== 'idle') return
    void askCoach()
  }, [askCoach, best, coachOpen, coachStatus, coachTips, gameOver])

  async function reset() {
    let id = gameId
    try {
      id = await mintGameId()
    } catch {
      id = null
    }

    skipEngineOnce.current = playerColor === 'black'
    syncingFromUrlRef.current = true
    urlReadyRef.current = true
    urlHistoryIndexRef.current = 0
    setUrlHistoryIndex(0)
    setGameId(id)
    if (id) replaceGameInUrl(START_FEN, id, 0)

    setBoard(createBoard())
    setSelected(null)
    setMoves([])
    setGameOver(null)
    setEndgameDismissed(false)
    setMovingTo(null)
    setPendingEngineMove(null)
    setBest(null)
    setCoachTips(null)
    setTip3Open(false)
    setCoachError(null)
    resetHistory()
    resetTurn()
  }

  function onFenChange(next: string) {
    setFenDraft(next)
  }

  function onFenCommit() {
    const next = fenDraft.trim()
    if (!next || next === fen) return
    if (!applyFen(next)) setFenDraft(fen)
  }

  function onColorChange(color: Color) {
    setPlayerColor(color)
    localStorage.setItem(COLOR_KEY, color)
    skipEngineOnce.current = turn === color
  }

  function onStrengthChange(level: StrengthLevel) {
    setStrength(level)
    localStorage.setItem(STRENGTH_KEY, String(level))
  }

  function onUndo() {
    if (urlHistoryIndex <= 0 || opponentThinking || movingTo) return
    // Full turn = your ply + opponent reply (two URL entries when available)
    window.history.go(urlHistoryIndex >= 2 ? -2 : -1)
  }

  const onEngineMoveConsumed = useCallback(() => {
    setPendingEngineMove(null)
  }, [])

  const status = useMemo(() => {
    if (gameOver) return `${gameOver.winner} wins (${gameOver.type})`
    if (opponentThinking) return `Opponent thinking…`
    return `${turn} to move`
  }, [gameOver, opponentThinking, turn])

  const boardTheme = useMemo(() => getBoardTheme(boardId), [boardId])
  const pieceSet = useMemo(() => getPieceSet(pieceSetId), [pieceSetId])
  const roomTheme = useMemo(() => getRoomTheme(roomId), [roomId])

  useEffect(() => {
    preloadBoard(boardTheme)
    preloadPieceSet(pieceSet)
    preloadRoom(roomTheme)
  }, [boardTheme, pieceSet, roomTheme])

  const dumpView = useCallback(() => {
    const snap = getLiveView()
    if (!snap) {
      console.warn('No view snapshot yet — orbit the board once.')
      return
    }
    const text = formatViewForThemes(snap)
    console.log(text)
    console.log('JSON', snap)
    void navigator.clipboard?.writeText(text).then(
      () => console.log('Copied themes snippet to clipboard'),
      () => undefined,
    )
  }, [])

  return (
    <div className="app" onPointerDown={() => unlockSfx()}>
      {endOutcome && !endgameDismissed && (
        <EndGameOverlay
          outcome={endOutcome}
          onNewGame={reset}
          onDismiss={() => setEndgameDismissed(true)}
        />
      )}

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        boardId={boardId}
        pieceSetId={pieceSetId}
        roomId={roomId}
        muted={muted}
        volume={volume}
        strength={strength}
        playerColor={playerColor}
        fen={fenDraft}
        showBestMove={showBestMove}
        onBoardChange={setBoardId}
        onPieceSetChange={setPieceSetId}
        onRoomChange={setRoomId}
        onMutedChange={setMutedState}
        onVolumeChange={setVolumeState}
        onStrengthChange={onStrengthChange}
        onColorChange={onColorChange}
        onFenChange={onFenChange}
        onFenCommit={onFenCommit}
        onDumpView={dumpView}
        onShowBestMoveChange={setShowBestMove}
      />

      <CoachDialog
        open={coachOpen}
        onClose={() => setCoachOpen(false)}
        fen={fen}
        best={best}
        analysisStatus={analysisStatus}
        analysisError={analysisError}
        coachTips={coachTips}
        coachStatus={coachStatus}
        coachError={coachError}
        tip3Open={tip3Open}
        onTip3OpenChange={setTip3Open}
      />

      <div className="layout">
        <section className="stage">
          <header className="hud">
            <div className="hud-left">
              <p className="eyebrow">3D Chess</p>
              <div className="hud-status-row">
                <p className="status">{status}</p>
                <div className="fps-slot" ref={fpsParentRef} />
              </div>
            </div>
            <div className="hud-actions">
              <CoachIconButton
                active={coachOpen}
                onClick={() => {
                  if (coachStatus === 'error') {
                    setCoachStatus('idle')
                    setCoachError(null)
                  }
                  setCoachOpen(true)
                }}
              />
              <PixelButton onClick={() => setSettingsOpen(true)}>
                Settings
              </PixelButton>
              <PixelButton
                ghost
                onClick={onUndo}
                disabled={urlHistoryIndex <= 0 || opponentThinking}
              >
                Undo
              </PixelButton>
              <PixelButton onClick={reset}>New game</PixelButton>
            </div>
          </header>

          <Canvas
            shadows
            dpr={[1, 1.5]}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
            camera={{
              position: roomTheme.cameraPosition ?? [0, 12, 9],
              fov: roomTheme.cameraFov ?? 40,
            }}
          >
            <Stats
              className="fps-meter"
              parent={fpsParentRef as React.RefObject<HTMLElement>}
            />
            <RoomCamera
              position={roomTheme.cameraPosition ?? [0, 12, 9]}
              fov={roomTheme.cameraFov ?? 40}
              target={roomTheme.boardOffset ?? [0, 0, 0]}
            />
            <color attach="background" args={[roomTheme.background]} />
            <Environment files={roomTheme.hdr} environmentIntensity={0.6} />
            <RoomScene theme={roomTheme} />
            <group position={roomTheme.boardOffset ?? [0, 0, 0]}>
              <BoardSurface theme={boardTheme} />
              {boardTheme.showProceduralBorder && <Border />}
              <BoardComponent
                selected={selected}
                setSelected={setSelected}
                board={board}
                setBoard={setBoard}
                moves={moves}
                setMoves={setMoves}
                setGameOver={setGameOver}
                playerColor={playerColor}
                tipFrom={tipFrom}
                tipTo={tipTo}
                pendingEngineMove={pendingEngineMove}
                onEngineMoveConsumed={onEngineMoveConsumed}
                boardTheme={boardTheme}
                pieceSet={pieceSet}
                roomTheme={roomTheme}
                boardId={boardId}
                pieceSetId={pieceSetId}
              />
            </group>
          </Canvas>
        </section>
      </div>
    </div>
  )
}
