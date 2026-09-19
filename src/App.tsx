import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Environment, Stats } from '@react-three/drei'
import { copyBoard, createBoard } from '@logic/board'
import type { Board } from '@logic/board'
import type { Color, Move, Piece } from '@logic/pieces'
import { getTile, movesForPiece } from '@logic/pieces'
import { BoardComponent, type GameOver } from '@/components/Board'
import { GamePanel, type GameTabId } from '@/components/GamePanel'
import type { CoachChatMessage } from '@/components/CoachPane'
import { AnalysisDialog } from '@/components/AnalysisDialog'
import { DrillDialog } from '@/components/DrillDialog'
import { PanelResizeHandle } from '@/components/PanelResizeHandle'
import { PanelViewFit } from '@/components/PanelViewFit'
import {
  GradientButtonGroup,
} from '@/components/ui/gradient-button-group'
import { HudEval } from '@/components/HudEval'
import { SettingsDrawer } from '@/components/SettingsDrawer'
import { PixelButton } from '@/components/ui/PixelButton'
import { Joystick } from 'lucide-react'
import { Border } from '@models/Border'
import { BoardSurface, preloadBoard } from '@models/BoardSurface'
import { RoomScene, preloadRoom } from '@models/RoomScene'
import { preloadPieceSet } from '@models/PieceModel'
import { useGameState, type HistoryItem } from '@/state/game'
import {
  boardToFen,
  fenToGame,
  pushGameToUrl,
  readFenFromUrl,
  readGameIdFromUrl,
  readLineFromUrl,
  readOpeningFromUrl,
  readPanelFromUrl,
  replaceDrillInUrl,
  replaceGameInUrl,
  replacePanelInUrl,
  squareToPosition,
  START_FEN,
  type PanelId,
  type UrlGameState,
} from '@/lib/fenBridge'
import {
  stockfishOpponent,
  type BestMoveResult,
  type StrengthLevel,
} from '@/lib/stockfishOpponent'
import { EndGameOverlay, outcomeFromResult } from '@/EndGameOverlay'
import { parseCoachExplain } from '@/lib/coachTips'
import {
  analyzeGamePlies,
  buildPlyTimeline,
  buildReportSummary,
  pliesForCoachApi,
  type AnalysisReport,
} from '@/lib/gameReview'
import {
  isChessComGameUrl,
  parsePgnToImportedGame,
  positionAtPly,
  type ImportedGame,
} from '@/lib/pgnImport'
import {
  getBoardTheme,
  getPieceSet,
  getRoomTheme,
  loadBoardId,
  loadMuted,
  loadPieceSetId,
  loadRoomId,
  loadBestMoveDelaySec,
  loadShowBestMove,
  loadShowFps,
  loadShowMoveIndicators,
  loadVolume,
} from '@/lib/themes'
import { unlockSfx } from '@/lib/sfx'
import {
  initMusicFromStorage,
  loadMusicTrackId,
  type MusicTrackId,
} from '@/lib/music'
import { formatViewForThemes, getLiveView } from '@/lib/viewDebug'
import {
  clearDefaultCamera,
  hasDefaultCamera,
  saveDefaultCamera,
  loadDefaultCamera,
} from '@/lib/cameraPrefs'
import {
  applyPanelLayoutCss,
  loadPanelWidth,
} from '@/lib/panelWidth'
import { ITALIAN_LINES } from '@/lib/drills/italian'
import type { DrillLine, DrillProgress } from '@/lib/drills/types'
import {
  expectedSan,
  hintForPly,
  historyItemMatchesSan,
  isPlayerPly,
  recommendPhrase,
  sanToBoardMove,
  squaresForSan,
} from '@/lib/drills/engine'
import {
  loadDrillProgress,
  recordLineClear,
  saveDrillProgress,
} from '@/lib/drills/progress'
import { fetchOpeningCard, type OpeningCard } from '@/lib/openingCard'
import './App.css'

const STRENGTH_KEY = 'chess-3d:strength'
const COLOR_KEY = 'chess-3d:playerColor'
const CHESSCOM_USER_KEY = 'chess-3d:chessComUsername'

function loadStrength(): StrengthLevel {
  const raw = Number(localStorage.getItem(STRENGTH_KEY) ?? 3)
  if (raw >= 1 && raw <= 8) return raw as StrengthLevel
  return 3
}

function loadPlayerColor(): Color {
  return localStorage.getItem(COLOR_KEY) === 'black' ? 'black' : 'white'
}

function loadChessComUsername(): string {
  return localStorage.getItem(CHESSCOM_USER_KEY) ?? ''
}

const DEFAULT_CAMERA_POS: [number, number, number] = [0, 12, 9]
const DEFAULT_CAMERA_TARGET: [number, number, number] = [0, 0, 0]

/** Push camera to the active room's preset (or saved default) when the room changes. */
function RoomCamera({
  roomId,
  position,
  fov,
  target,
}: {
  roomId: string
  position: [number, number, number]
  fov: number
  target: [number, number, number]
}) {
  const { camera, controls } = useThree()
  // Layout so PanelViewFit (sibling) sees the new framing in the same commit.
  // Only roomId: inline fallback arrays must not re-snap the camera on every click/re-render.
  useLayoutEffect(() => {
    const saved = loadDefaultCamera(roomId)
    const pos = saved?.position ?? position
    const tgt = saved?.target ?? target
    camera.position.set(...pos)
    if ('fov' in camera) {
      ;(camera as typeof camera & { fov: number }).fov = fov
      ;(
        camera as typeof camera & { updateProjectionMatrix: () => void }
      ).updateProjectionMatrix()
    }
    camera.lookAt(...tgt)
    const orbit = controls as { target?: THREE.Vector3; update?: () => void } | null
    if (orbit?.target) {
      orbit.target.set(...tgt)
      orbit.update?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: room switch only
  }, [camera, controls, roomId])
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
  const [analysis, setAnalysis] = useState<{
    fen: string
    lines: BestMoveResult[]
  } | null>(null)
  const [moveOptionIndex, setMoveOptionIndex] = useState(0)
  const [analysisStatus, setAnalysisStatus] = useState<
    'idle' | 'loading' | 'error'
  >('idle')
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [coachExplanation, setCoachExplanation] = useState<string | null>(null)
  const [coachStatus, setCoachStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle',
  )
  const [coachError, setCoachError] = useState<string | null>(null)
  const [coachChat, setCoachChat] = useState<CoachChatMessage[]>([])
  const [coachChatStatus, setCoachChatStatus] = useState<
    'idle' | 'loading' | 'error'
  >('idle')
  const [coachChatError, setCoachChatError] = useState<string | null>(null)
  const [coachReviewMode, setCoachReviewMode] = useState(false)
  const [gameTab, setGameTab] = useState<GameTabId>('moves')
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewProgress, setReviewProgress] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewImport, setReviewImport] = useState<ImportedGame | null>(null)
  const [scrubIndex, setScrubIndex] = useState(0)
  const [analysisReport, setAnalysisReport] = useState<AnalysisReport | null>(
    null,
  )
  const [importDraft, setImportDraft] = useState('')
  const [chessComUsername, setChessComUsername] = useState(loadChessComUsername)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [opponentThinking, setOpponentThinking] = useState(false)
  const [pendingEngineMove, setPendingEngineMove] = useState<Move | null>(null)
  const [gameId, setGameId] = useState<string | null>(() => readGameIdFromUrl())
  const [boardId, setBoardId] = useState(loadBoardId)
  const [pieceSetId, setPieceSetId] = useState(loadPieceSetId)
  const [roomId, setRoomId] = useState(loadRoomId)
  const [muted, setMutedState] = useState(loadMuted)
  const [volume, setVolumeState] = useState(loadVolume)
  const [musicTrackId, setMusicTrackId] = useState<MusicTrackId>(loadMusicTrackId)
  const [showBestMove, setShowBestMove] = useState(loadShowBestMove)
  const [bestMoveDelaySec, setBestMoveDelaySec] = useState(loadBestMoveDelaySec)
  const [bestMoveDelayElapsed, setBestMoveDelayElapsed] = useState(false)
  const [showFps, setShowFps] = useState(loadShowFps)
  const [showMoveIndicators, setShowMoveIndicators] = useState(
    loadShowMoveIndicators,
  )
  const [panel, setPanel] = useState<PanelId | null>(() => readPanelFromUrl())
  const settingsOpen = panel === 'settings'
  const gameOpen = panel === 'game'
  const analysisOpen = panel === 'analysis'
  const drillOpen = panel === 'drill'
  const rightPanelOpen =
    settingsOpen || gameOpen || analysisOpen || drillOpen
  const [panelWidth, setPanelWidth] = useState(loadPanelWidth)
  const [panelFitEpoch, setPanelFitEpoch] = useState(0)

  useEffect(() => {
    applyPanelLayoutCss(panelWidth)
  }, [panelWidth])

  // Refit on load, panel open, and theme swaps (room camera / board footprint).
  useEffect(() => {
    if (!rightPanelOpen) return
    setPanelFitEpoch((n) => n + 1)
    const t = window.setTimeout(() => setPanelFitEpoch((n) => n + 1), 120)
    return () => window.clearTimeout(t)
  }, [rightPanelOpen, roomId, boardId, pieceSetId, drillOpen])

  const onPanelWidthChange = useCallback((w: number) => {
    setPanelWidth(w)
    applyPanelLayoutCss(w)
  }, [])

  const onPanelResizeEnd = useCallback((w: number) => {
    setPanelWidth(w)
    applyPanelLayoutCss(w)
    setPanelFitEpoch((n) => n + 1)
  }, [])

  const [orbitDragMode, setOrbitDragMode] = useState<'move' | 'rotate' | 'pan'>(
    'move',
  )
  const skipEngineOnce = useRef(false)
  const coachAbortRef = useRef<AbortController | null>(null)
  const coachChatAbortRef = useRef<AbortController | null>(null)
  /** Ephemeral Cursor chat id for drills — never written to the URL; reminted per line. */
  const drillChatGameIdRef = useRef<string | null>(null)
  const reviewAbortRef = useRef<AbortController | null>(null)
  const syncingFromUrlRef = useRef(false)
  const urlReadyRef = useRef(false)
  const urlHistoryIndexRef = useRef(0)
  const gameIdRef = useRef<string | null>(gameId)
  gameIdRef.current = gameId
  const [urlHistoryIndex, setUrlHistoryIndex] = useState(0)
  const fpsParentRef = useRef<HTMLDivElement>(null)

  const [drillLine, setDrillLine] = useState<DrillLine | null>(null)
  const [drillPlyIndex, setDrillPlyIndex] = useState(0)
  const [drillStatus, setDrillStatus] = useState<
    'idle' | 'playing' | 'complete'
  >('idle')
  const [drillProgress, setDrillProgress] = useState<DrillProgress>(() =>
    loadDrillProgress(),
  )
  const [drillWrongFlash, setDrillWrongFlash] = useState(false)
  const [drillHintRevealed, setDrillHintRevealed] = useState(false)
  const [drillMistake, setDrillMistake] = useState<{
    from: { x: number; y: number }
    to: { x: number; y: number }
    expectedSan: string
  } | null>(null)
  const [drillMistakes, setDrillMistakes] = useState(false)
  const drillWrongTimerRef = useRef<number | null>(null)
  const drillLiveSnapshotRef = useRef<{
    board: Board
    turn: Color
    history: HistoryItem[]
    playerColor: Color
    gameOver: GameOver | null
  } | null>(null)
  const [drillReview, setDrillReview] = useState<{
    history: HistoryItem[]
    finalBoard: Board
    turn: Color
  } | null>(null)
  const [openingCard, setOpeningCard] = useState<OpeningCard | null>(null)
  const [openingCardStatus, setOpeningCardStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const openingCardReqRef = useRef(0)
  const startDrillLineRef = useRef<(lineId: string) => void>(() => {})


  const turn = useGameState((s) => s.turn)
  const resetTurn = useGameState((s) => s.resetTurn)
  const history = useGameState((s) => s.history)
  const resetHistory = useGameState((s) => s.resetHistory)
  const popHistory = useGameState((s) => s.popHistory)
  const setMovingTo = useGameState((s) => s.setMovingTo)
  const movingTo = useGameState((s) => s.movingTo)

  const fenHistory =
    reviewImport != null ? history.slice(0, scrubIndex) : history
  const fen = useMemo(
    () => boardToFen(board, turn, fenHistory),
    [board, turn, fenHistory],
  )

  // Ignore analysis from a previous FEN (avoids one-frame stale lines after a move).
  const lines =
    analysis && analysis.fen === fen && analysisStatus === 'idle'
      ? analysis.lines
      : []
  const clampedOptionIndex =
    lines.length === 0 ? 0 : Math.min(moveOptionIndex, lines.length - 1)
  const best = lines[clampedOptionIndex] ?? null
  const analysisReadyForFen =
    analysisStatus === 'idle' &&
    !!analysis &&
    analysis.fen === fen &&
    lines.length > 0

  const [fenDraft, setFenDraft] = useState(fen)

  useEffect(() => {
    initMusicFromStorage()
  }, [])

  useEffect(() => {
    setFenDraft(fen)
  }, [fen])

  // Mint a coach session id for free-play resume. Skip practice URLs; coach open/ask mints on demand.
  useEffect(() => {
    if (gameId) return
    if (readPanelFromUrl() === 'drill') return
    const controller = new AbortController()
    mintGameId(controller.signal)
      .then((id) => {
        // Panel may have switched to drill while the request was in flight.
        if (readPanelFromUrl() === 'drill') {
          setGameId(id)
          return
        }
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
    if (reviewImport) {
      // Scrubbing shouldn't flood browser history.
      replaceGameInUrl(fen, gameId, urlHistoryIndexRef.current)
      return
    }
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
  }, [fen, gameId, reviewImport])

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
    setAnalysis(null)
    setMoveOptionIndex(0)
    setReviewImport(null)
    setScrubIndex(0)
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
      setPanel(readPanelFromUrl() ?? state?.panel ?? null)
      applyFen(fromUrl)
      const lineRef = readLineFromUrl() ?? state?.line ?? null
      const opening = readOpeningFromUrl() ?? state?.opening ?? null
      const panelNow = readPanelFromUrl() ?? state?.panel ?? null
      if (panelNow === 'drill' && lineRef && (!opening || opening === 'italian')) {
        startDrillLineRef.current(lineRef)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [applyFen])

  const openPanel = useCallback((next: PanelId | null) => {
    setPanel(next)
    // Re-open drill with the remembered line in the URL (and picker).
    if (next === 'drill' && drillLine) {
      replaceDrillInUrl('italian', drillLine.id)
      return
    }
    replacePanelInUrl(next)
    // Game panel coach needs gameId in the URL for session resume.
    if (next === 'game' && gameId) {
      replaceGameInUrl(fen, gameId, urlHistoryIndexRef.current)
    }
  }, [drillLine, fen, gameId])

  // Delay best-move arrow after analysis is ready (coach tip 3 still shows immediately).
  useEffect(() => {
    setBestMoveDelayElapsed(false)
    if (!showBestMove || !analysisReadyForFen) return
    if (bestMoveDelaySec <= 0) {
      setBestMoveDelayElapsed(true)
      return
    }
    const timer = window.setTimeout(
      () => setBestMoveDelayElapsed(true),
      bestMoveDelaySec * 1000,
    )
    return () => window.clearTimeout(timer)
  }, [fen, showBestMove, bestMoveDelaySec, analysisReadyForFen])

  const showBestArrow =
    (showBestMove && bestMoveDelayElapsed) ||
    (gameOpen && gameTab === 'coach' && !!best)

  const drillHintSquares = useMemo(() => {
    if (
      !drillLine ||
      drillStatus !== 'playing' ||
      !drillHintRevealed ||
      !isPlayerPly(drillPlyIndex)
    ) {
      return null
    }
    const san = expectedSan(drillLine, drillPlyIndex)
    if (!san) return null
    return squaresForSan(board, history, turn, san)
  }, [
    board,
    drillHintRevealed,
    drillLine,
    drillPlyIndex,
    drillStatus,
    history,
    turn,
  ])

  const tipFrom =
    drillHintSquares?.from ??
    (showBestArrow && best ? squareToPosition(best.from) : null)
  const tipTo =
    drillHintSquares?.to ??
    (showBestArrow && best ? squareToPosition(best.to) : null)

  const endOutcome = outcomeFromResult(gameOver, playerColor)
  const scrubbingImport =
    !!reviewImport && scrubIndex < reviewImport.history.length
  const terminalOver = !!gameOver && !scrubbingImport
  const drillActive = drillStatus === 'playing' || drillStatus === 'complete'

  // Analyze on the player's turn only. Full MultiPV shares one Stockfish worker with
  // getMove — running it while the opponent is to move queues the reply behind ~depth-18
  // and can stall "Opponent thinking…" for ~30s instead of a few seconds.
  useEffect(() => {
    if (terminalOver || drillOpen || reviewImport) {
      setAnalysis(null)
      setMoveOptionIndex(0)
      setAnalysisStatus('idle')
      return
    }
    if (turn !== playerColor) {
      setAnalysis(null)
      setMoveOptionIndex(0)
      setAnalysisStatus('idle')
      return
    }
    // Drop previous position’s move immediately so coach/arrow never use a stale best.
    setAnalysis(null)
    setMoveOptionIndex(0)
    setAnalysisStatus('loading')
    setAnalysisError(null)

    const analyzedFen = fen
    const controller = new AbortController()
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const result = await stockfishOpponent.getBestMove(
          analyzedFen,
          controller.signal,
        )
        if (cancelled) return
        setAnalysis({ fen: analyzedFen, lines: result.lines })
        setMoveOptionIndex(0)
        setAnalysisStatus('idle')
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError'))
          return
        setAnalysis(null)
        setMoveOptionIndex(0)
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
  }, [fen, terminalOver, turn, playerColor, drillOpen, reviewImport])

  // Wipe position-specific tips when the board changes (keep chat).
  // Imported review scrubbing / coach review mode must keep the recap.
  useEffect(() => {
    coachAbortRef.current?.abort()
    coachAbortRef.current = null
    if (coachReviewMode || reviewImport) return
    setCoachExplanation(null)
    setCoachStatus('idle')
    setCoachError(null)
    setCoachReviewMode(false)
    reviewAbortRef.current?.abort()
  }, [fen, coachReviewMode, reviewImport])

  // Opponent Stockfish replies
  useEffect(() => {
    if (
      reviewImport ||
      drillActive ||
      drillOpen ||
      gameOver ||
      movingTo ||
      pendingEngineMove
    )
      return
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
    reviewImport,
    drillActive,
    drillOpen,
  ])

  // Leave drill session cleanly when closing the panel — restore live game,
  // but keep the selected line so the picker still shows it on reopen.
  useEffect(() => {
    if (drillOpen) return
    const snap = drillLiveSnapshotRef.current
    drillLiveSnapshotRef.current = null
    if (snap) {
      setBoard(copyBoard(snap.board))
      useGameState.setState({
        turn: snap.turn,
        history: snap.history,
        movingTo: null,
      })
      setPlayerColor(snap.playerColor)
      setGameOver(snap.gameOver)
      setPendingEngineMove(null)
      setSelected(null)
      setMoves([])
      skipEngineOnce.current = true
    }
    setDrillPlyIndex(0)
    setDrillStatus('idle')
    setDrillHintRevealed(false)
    setDrillWrongFlash(false)
    setDrillMistake(null)
    setDrillMistakes(false)
    setDrillReview(null)
    clearCoachThread()
    drillChatGameIdRef.current = null
    if (drillWrongTimerRef.current != null) {
      window.clearTimeout(drillWrongTimerRef.current)
      drillWrongTimerRef.current = null
    }
  }, [drillOpen])

  // After each completed ply in a drill, advance index / finish line
  useEffect(() => {
    if (!drillLine || drillStatus !== 'playing' || movingTo) return
    if (drillMistake) return
    if (history.length !== drillPlyIndex + 1) return

    // Player just moved — Chessreps-style: land wrong moves, then coach + try again.
    if (isPlayerPly(drillPlyIndex)) {
      const expected = expectedSan(drillLine, drillPlyIndex)
      const last = history[history.length - 1]
      if (
        expected &&
        last &&
        !historyItemMatchesSan(last, history.slice(0, -1), expected)
      ) {
        setDrillMistakes(true)
        setDrillMistake({
          from: last.from,
          to: last.to,
          expectedSan: expected,
        })
        return
      }
    }

    const next = drillPlyIndex + 1
    if (next >= drillLine.moves.length) {
      setDrillPlyIndex(next)
      setDrillStatus('complete')
      setDrillHintRevealed(false)
      setPendingEngineMove(null)
      setDrillReview({
        history: [...history],
        finalBoard: copyBoard(board),
        turn,
      })
      if (!drillMistakes) {
        const updated = recordLineClear(drillProgress, drillLine.id)
        setDrillProgress(updated)
        saveDrillProgress(updated)
      } else if (!drillProgress.discovered.includes(drillLine.id)) {
        const updated: DrillProgress = {
          ...drillProgress,
          discovered: [...drillProgress.discovered, drillLine.id],
        }
        setDrillProgress(updated)
        saveDrillProgress(updated)
      }
      return
    }
    setDrillPlyIndex(next)
    setDrillHintRevealed(false)
  }, [
    board,
    drillLine,
    drillStatus,
    drillPlyIndex,
    drillMistake,
    drillMistakes,
    drillProgress,
    history,
    movingTo,
    turn,
  ])
  // Auto-play Black replies from the drill line
  useEffect(() => {
    if (!drillLine || drillStatus !== 'playing') return
    if (drillMistake) return
    if (movingTo || pendingEngineMove) return
    if (isPlayerPly(drillPlyIndex)) return
    if (history.length !== drillPlyIndex) return
    const san = expectedSan(drillLine, drillPlyIndex)
    if (!san) return
    const move = sanToBoardMove(board, history, turn, san)
    if (move) setPendingEngineMove(move)
  }, [
    board,
    drillLine,
    drillPlyIndex,
    drillMistake,
    drillStatus,
    history,
    movingTo,
    pendingEngineMove,
    turn,
  ])

  const validateDrillMove = useCallback(
    (_move: Move) => {
      if (!drillLine || drillStatus !== 'playing') return true
      if (drillMistake) return false
      if (!isPlayerPly(drillPlyIndex)) return false
      // Allow any legal move — wrong book moves land, then coach asks to try again.
      return true
    },
    [drillLine, drillMistake, drillPlyIndex, drillStatus],
  )

  function retryDrillMistake() {
    if (!drillMistake || history.length === 0) return
    const last = history[history.length - 1]
    skipEngineOnce.current = true
    setBoard(copyBoard(last.board))
    popHistory()
    useGameState.setState({ turn: last.piece.color, movingTo: null })
    setDrillMistake(null)
    setDrillWrongFlash(false)
    setSelected(null)
    setMoves([])
    setPendingEngineMove(null)
  }

  function clearCoachThread() {
    coachAbortRef.current?.abort()
    coachAbortRef.current = null
    coachChatAbortRef.current?.abort()
    coachChatAbortRef.current = null
    setCoachChat([])
    setCoachChatStatus('idle')
    setCoachChatError(null)
    setCoachExplanation(null)
    setCoachStatus('idle')
    setCoachError(null)
    setCoachReviewMode(false)
  }

  function startDrillLine(lineId: string) {
    const line =
      ITALIAN_LINES.find((l) => l.id === lineId) ??
      ITALIAN_LINES.find((l) => l.name === lineId) ??
      null
    if (!line) return
    if (!drillLiveSnapshotRef.current) {
      drillLiveSnapshotRef.current = {
        board: copyBoard(board),
        turn,
        history: [...history],
        playerColor,
        gameOver,
      }
    }
    skipEngineOnce.current = true
    // Fresh chat UI + ephemeral session for this line (does not survive refresh).
    clearCoachThread()
    drillChatGameIdRef.current = null
    setReviewImport(null)
    setScrubIndex(0)
    setAnalysisReport(null)
    setBoard(createBoard())
    setSelected(null)
    setMoves([])
    setGameOver(null)
    setEndgameDismissed(true)
    setMovingTo(null)
    setPendingEngineMove(null)
    resetHistory()
    resetTurn()
    setPlayerColor('white')
    setDrillLine(line)
    setDrillPlyIndex(0)
    setDrillStatus('playing')
    setDrillMistakes(false)
    setDrillHintRevealed(false)
    setDrillWrongFlash(false)
    setDrillMistake(null)
    setDrillReview(null)
    setPanel('drill')
    replaceDrillInUrl('italian', line.id)

    const req = ++openingCardReqRef.current
    // Keep the hand-authored summary visible; upgrade blurb when Turso/cache returns.
    setOpeningCard(null)
    setOpeningCardStatus('loading')
    void fetchOpeningCard(line)
      .then((card) => {
        if (openingCardReqRef.current !== req) return
        setOpeningCard(card)
        setOpeningCardStatus('ready')
      })
      .catch(() => {
        if (openingCardReqRef.current !== req) return
        setOpeningCard(null)
        setOpeningCardStatus('error')
      })
  }

  // Restore drill opening/line from the URL (refresh / shared link).
  startDrillLineRef.current = startDrillLine
  const drillBootstrapped = useRef(false)
  useEffect(() => {
    if (drillBootstrapped.current) return
    drillBootstrapped.current = true
    if (readPanelFromUrl() !== 'drill') return
    const opening = readOpeningFromUrl()
    const lineRef = readLineFromUrl()
    if (!lineRef) return
    if (opening && opening !== 'italian') return
    startDrillLineRef.current(lineRef)
  }, [])

  function restartDrill() {
    if (drillLine) startDrillLine(drillLine.id)
  }

  function scrubDrillTo(index: number) {
    if (!drillReview || drillStatus !== 'complete') return
    const next = Math.max(0, Math.min(index, drillReview.history.length))
    const pos = positionAtPly(drillReview, next)
    setDrillPlyIndex(next)
    setBoard(pos.board)
    useGameState.setState({ turn: pos.turn, movingTo: null })
    setSelected(null)
    setMoves([])
    setPendingEngineMove(null)
  }
  const askCoach = useCallback(async () => {
    if (coachStatus === 'loading') return
    // Only after analysis for THIS fen is ready — never the opponent’s turn.
    if (turn !== playerColor) return
    if (
      analysisStatus !== 'idle' ||
      !analysis ||
      analysis.fen !== fen ||
      analysis.lines.length === 0
    ) {
      return
    }

    const engineLines = analysis.lines
    coachAbortRef.current?.abort()
    const controller = new AbortController()
    coachAbortRef.current = controller
    setCoachStatus('loading')
    setCoachError(null)
    setCoachExplanation(null)

    try {
      let id = gameId
      if (!id) {
        id = await mintGameId(controller.signal)
        setGameId(id)
        replaceGameInUrl(fen, id, urlHistoryIndexRef.current)
      }

      const fullmove = fen.split(/\s+/)[5] ?? '?'
      const { Chess } = await import('chess.js')
      const options = []
      for (const line of engineLines) {
        let moveLabel = `${line.from} → ${line.to}`
        try {
          const chess = new Chess(fen)
          const played = chess.move({
            from: line.from,
            to: line.to,
            promotion: line.uci.length > 4 ? line.uci[4] : undefined,
          })
          if (!played) continue
          moveLabel = `${played.san} (${line.from} → ${line.to})`
        } catch {
          continue
        }
        options.push({
          bestMove: `${line.uci} = ${moveLabel}`,
          from: line.from,
          to: line.to,
          evalLabel: line.evalLabel,
          line: line.line,
        })
      }

      if (options.length === 0) {
        throw new Error(
          'Analysis moves don’t match this position yet — try again',
        )
      }

      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          fen,
          options,
          gameId: id,
          plyHint: `about move ${fullmove}, White=${turn === 'white' ? 'to play' : 'waiting'}, Black=${turn === 'black' ? 'to play' : 'waiting'} (${turn} to play; ${history.length} plies recorded this session)`,
          openingLineId: drillOpen && drillLine ? drillLine.id : undefined,
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

      const explained = parseCoachExplain(assembled)
      if (!explained?.explanation) {
        throw new Error('Coach reply was not in the expected format')
      }
      setCoachExplanation(explained.explanation)
      setCoachStatus('idle')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setCoachStatus('error')
      setCoachError(err instanceof Error ? err.message : 'Ask coach failed')
    }
  }, [
    analysis,
    analysisStatus,
    coachStatus,
    fen,
    gameId,
    history.length,
    playerColor,
    turn,
    drillOpen,
    drillLine,
  ])

  const sendCoachChat = useCallback(
    async (question: string) => {
      const q = question.trim()
      if (!q || coachChatStatus === 'loading') return
      if (!coachReviewMode && !drillOpen && turn !== playerColor) return

      coachChatAbortRef.current?.abort()
      const controller = new AbortController()
      coachChatAbortRef.current = controller

      const userId = `u-${Date.now()}`
      const assistantId = `a-${Date.now()}`
      setCoachChat((prev) => [
        ...prev,
        { id: userId, role: 'user', text: q },
        { id: assistantId, role: 'assistant', text: '' },
      ])
      setCoachChatStatus('loading')
      setCoachChatError(null)

      try {
        let id: string
        if (drillOpen) {
          // Drill chats are ephemeral — never reuse free-play gameId or write to URL.
          id = drillChatGameIdRef.current ?? (await mintGameId(controller.signal))
          drillChatGameIdRef.current = id
        } else {
          id = gameId ?? (await mintGameId(controller.signal))
          if (!gameId) {
            setGameId(id)
            replaceGameInUrl(fen, id, urlHistoryIndexRef.current)
          }
        }

        const res = await fetch('/api/coach-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            gameId: id,
            fen,
            question: q,
            bestMove: best
              ? `${best.uci} (${best.from} → ${best.to})`
              : undefined,
            evalLabel: best?.evalLabel,
            explanation: coachExplanation ?? undefined,
            engineLines: lines.slice(0, 3).map((l) => ({
              uci: l.uci,
              from: l.from,
              to: l.to,
              evalLabel: l.evalLabel,
            })),
            openingLineId: drillOpen && drillLine ? drillLine.id : undefined,
          }),
        })
        if (!res.ok || !res.body) {
          throw new Error(`Chat failed (${res.status})`)
        }

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
              const snapshot = assembled
              setCoachChat((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, text: snapshot } : m,
                ),
              )
            } else if (payload.type === 'done') {
              if (payload.text) assembled = payload.text
              const snapshot = assembled
              setCoachChat((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, text: snapshot } : m,
                ),
              )
            } else if (payload.type === 'error') {
              throw new Error(payload.error || 'Chat failed')
            }
          }
        }

        if (!assembled.trim()) {
          throw new Error('Empty coach reply')
        }
        setCoachChatStatus('idle')
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setCoachChatStatus('error')
        setCoachChatError(
          err instanceof Error ? err.message : 'Chat failed',
        )
        setCoachChat((prev) =>
          prev.filter((m) => m.id !== assistantId || m.text.trim()),
        )
      }
    },
    [
      best,
      coachChatStatus,
      coachExplanation,
      coachReviewMode,
      fen,
      gameId,
      lines,
      playerColor,
      turn,
      drillOpen,
      drillLine,
    ],
  )

  const reviewGame = useCallback(
    async (override?: {
      playerColor?: Color
      fen?: string
      whiteName?: string | null
      blackName?: string | null
      session?: ImportedGame
    }) => {
      const hist =
        override?.session?.history ?? useGameState.getState().history
      if (reviewBusy || hist.length === 0) return
      const color =
        override?.playerColor ??
        override?.session?.playerColor ??
        playerColor
      const reviewFen =
        override?.fen ??
        override?.session?.finalFen ??
        reviewImport?.finalFen ??
        fen
      const whiteName =
        override?.whiteName ??
        override?.session?.whiteName ??
        reviewImport?.whiteName ??
        null
      const blackName =
        override?.blackName ??
        override?.session?.blackName ??
        reviewImport?.blackName ??
        null

      reviewAbortRef.current?.abort()
      const controller = new AbortController()
      reviewAbortRef.current = controller
      setReviewBusy(true)
      setReviewError(null)
      setReviewProgress('Building move list…')
      setAnalysisReport(null)

      let session = override?.session ?? reviewImport
      if (!session) {
        session = {
          history: hist,
          finalBoard: board,
          turn,
          playerColor: color,
          gameOver,
          finalFen: reviewFen,
          whiteName,
          blackName,
          result: null,
        }
      }
      setReviewImport(session)
      setScrubIndex(session.history.length)

      setEndgameDismissed(true)
      openPanel('analysis')

      try {
        const plies = buildPlyTimeline(hist, color)
        setReviewProgress(`Analyzing moves 0/${plies.length}…`)

        const tagged = await analyzeGamePlies(
          plies,
          hist,
          reviewFen,
          (done, total) => {
            setReviewProgress(`Analyzing moves ${done}/${total}…`)
          },
          controller.signal,
        )

        const summary = buildReportSummary(tagged)
        setAnalysisReport({
          plies: tagged,
          summary,
          whiteName,
          blackName,
          playerColor: color,
        })
        setReviewBusy(false)
        setReviewProgress(null)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setReviewBusy(false)
        setReviewProgress(null)
        const msg = err instanceof Error ? err.message : 'Review failed'
        setReviewError(msg)
      }
    },
    [
      board,
      fen,
      gameOver,
      openPanel,
      playerColor,
      reviewBusy,
      reviewImport,
      turn,
    ],
  )

  const askCoachRecap = useCallback(
    async (override?: {
      outcome?: 'win' | 'loss' | 'draw'
    }) => {
      if (!analysisReport || coachStatus === 'loading') return
      const color = analysisReport.playerColor
      const reviewFen = reviewImport?.finalFen ?? fen
      const outcome =
        override?.outcome ??
        (endOutcome === 'win' || endOutcome === 'loss' || endOutcome === 'draw'
          ? endOutcome
          : 'draw')

      reviewAbortRef.current?.abort()
      const controller = new AbortController()
      reviewAbortRef.current = controller
      setCoachReviewMode(true)
      setCoachExplanation(null)
      setCoachChat([])
      setCoachChatStatus('idle')
      setCoachChatError(null)
      setCoachStatus('loading')
      setCoachError(null)
      setGameTab('coach')
      openPanel('game')

      try {
        let id = await mintGameId(controller.signal)
        setGameId(id)
        replaceGameInUrl(reviewFen, id, urlHistoryIndexRef.current)

        const res = await fetch('/api/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            gameId: id,
            playerColor: color,
            outcome,
            plies: pliesForCoachApi(analysisReport.plies),
          }),
        })
        if (!res.ok || !res.body) {
          throw new Error(`Review failed (${res.status})`)
        }

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
              const parsed = parseCoachExplain(assembled)
              if (parsed) setCoachExplanation(parsed.explanation)
            } else if (payload.type === 'done') {
              if (payload.text) assembled = payload.text
              const parsed = parseCoachExplain(assembled)
              if (parsed) setCoachExplanation(parsed.explanation)
              else if (assembled.trim()) setCoachExplanation(assembled.trim())
            } else if (payload.type === 'error') {
              throw new Error(payload.error || 'Review failed')
            }
          }
        }

        const parsed = parseCoachExplain(assembled)
        setCoachExplanation(parsed?.explanation ?? (assembled.trim() || null))
        if (!parsed && !assembled.trim()) {
          throw new Error('Empty review')
        }
        setCoachStatus('idle')
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setCoachStatus('error')
        const msg = err instanceof Error ? err.message : 'Review failed'
        setCoachError(msg)
        setReviewError(msg)
      }
    },
    [
      analysisReport,
      coachStatus,
      endOutcome,
      fen,
      openPanel,
      reviewImport?.finalFen,
    ],
  )

  const applyImportedGame = useCallback(
    (imported: ImportedGame) => {
      setReviewImport(imported)
      setScrubIndex(imported.history.length)
      setPlayerColor(imported.playerColor)
      localStorage.setItem(COLOR_KEY, imported.playerColor)
      useGameState.setState({
        history: imported.history,
        turn: imported.turn,
        movingTo: null,
      })
      setBoard(imported.finalBoard)
      setSelected(null)
      setMoves([])
      setGameOver(imported.gameOver)
      setEndgameDismissed(true)
      setPendingEngineMove(null)
      setAnalysis(null)
      setMoveOptionIndex(0)
      setCoachExplanation(null)
      setCoachStatus('idle')
      setCoachError(null)
      setCoachChat([])
      setCoachChatStatus('idle')
      setCoachChatError(null)
      setCoachReviewMode(false)
      setAnalysisReport(null)
      skipEngineOnce.current = true
    },
    [],
  )

  const scrubTo = useCallback(
    (index: number) => {
      if (!reviewImport) return
      const next = Math.max(0, Math.min(index, reviewImport.history.length))
      const pos = positionAtPly(reviewImport, next)
      setScrubIndex(next)
      setBoard(pos.board)
      useGameState.setState({ turn: pos.turn, movingTo: null })
      setSelected(null)
      setMoves([])
      setPendingEngineMove(null)
    },
    [reviewImport],
  )

  const importGame = useCallback(async () => {
    const raw = importDraft.trim()
    if (!raw || importBusy) return
    setImportBusy(true)
    setImportError(null)
    setImportStatus(null)

    try {
      let pgn = raw
      if (isChessComGameUrl(raw)) {
        setImportStatus('Fetching chess.com game…')
        const res = await fetch('/api/import-chesscom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: raw }),
        })
        const data = (await res.json()) as { pgn?: string; error?: string }
        if (!res.ok || !data.pgn) {
          throw new Error(data.error || `Import failed (${res.status})`)
        }
        pgn = data.pgn
      }

      setImportStatus('Parsing PGN…')
      const imported = parsePgnToImportedGame(pgn, {
        preferColor: playerColor,
        chessComUsername: chessComUsername.trim() || null,
      })
      if (imported.history.length === 0) {
        throw new Error('PGN has no moves')
      }

      setImportStatus('Loading board…')
      applyImportedGame(imported)

      let id: string | null = null
      try {
        id = await mintGameId()
      } catch {
        id = null
      }
      if (id) {
        setGameId(id)
        replaceGameInUrl(imported.finalFen, id, 0)
        urlHistoryIndexRef.current = 0
        setUrlHistoryIndex(0)
        urlReadyRef.current = true
      }

      setImportStatus(null)
      setImportDraft('')
      setImportBusy(false)
      void reviewGame({
        playerColor: imported.playerColor,
        fen: imported.finalFen,
        whiteName: imported.whiteName,
        blackName: imported.blackName,
        session: imported,
      })
    } catch (err) {
      setImportBusy(false)
      setImportStatus(null)
      setImportError(err instanceof Error ? err.message : 'Import failed')
    }
  }, [
    applyImportedGame,
    chessComUsername,
    importBusy,
    importDraft,
    playerColor,
    reviewGame,
  ])

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
    setAnalysis(null)
    setMoveOptionIndex(0)
    setCoachExplanation(null)
    setCoachStatus('idle')
    setCoachError(null)
    setCoachChat([])
    setCoachChatStatus('idle')
    setCoachChatError(null)
    setCoachReviewMode(false)
    setReviewBusy(false)
    setReviewProgress(null)
    setReviewError(null)
    setReviewImport(null)
    setScrubIndex(0)
    setAnalysisReport(null)
    setImportError(null)
    setImportStatus(null)
    reviewAbortRef.current?.abort()
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
    if (reviewBusy && reviewProgress) return reviewProgress
    if (terminalOver) {
      if (gameOver?.type === 'draw' || gameOver?.type === 'stalemate') {
        return 'Draw'
      }
      if (gameOver?.winner) {
        return `${gameOver.winner} wins (${gameOver.type})`
      }
      return 'Game over'
    }
    if (reviewImport) {
      return `Review · ply ${scrubIndex}/${reviewImport.history.length} · ${turn} to move`
    }
    if (drillOpen && drillStatus === 'playing' && drillLine) {
      return `Drill · ${drillLine.name} · ply ${drillPlyIndex + 1}/${drillLine.moves.length}`
    }
    if (drillOpen && drillStatus === 'complete' && drillLine) {
      return `Drill complete · ${drillLine.name}`
    }
    if (opponentThinking) return `Opponent thinking…`
    return `${turn} to move`
  }, [
    gameOver,
    opponentThinking,
    reviewBusy,
    reviewImport,
    reviewProgress,
    scrubIndex,
    terminalOver,
    turn,
    drillOpen,
    drillStatus,
    drillLine,
    drillPlyIndex,
  ])

  const boardTheme = useMemo(() => getBoardTheme(boardId), [boardId])
  const pieceSet = useMemo(
    () => getPieceSet(drillOpen ? 'flat' : pieceSetId),
    [drillOpen, pieceSetId],
  )
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

  const [defaultAngleStatus, setDefaultAngleStatus] = useState<string | null>(
    null,
  )
  const [defaultAngleSaved, setDefaultAngleSaved] = useState(() =>
    hasDefaultCamera(roomId),
  )
  useEffect(() => {
    setDefaultAngleSaved(hasDefaultCamera(roomId))
    setDefaultAngleStatus(null)
  }, [roomId])

  const setDefaultAngle = useCallback(() => {
    const snap = getLiveView()
    if (!snap) {
      setDefaultAngleStatus('Orbit the board once, then try again.')
      return
    }
    saveDefaultCamera(roomId, snap.cameraPosition, snap.cameraTarget)
    setDefaultAngleSaved(true)
    setDefaultAngleStatus('Default angle saved for this room.')
    setPanelFitEpoch((n) => n + 1)
  }, [roomId])

  const clearDefaultAngle = useCallback(() => {
    clearDefaultCamera(roomId)
    setDefaultAngleSaved(false)
    setDefaultAngleStatus('Cleared — using the room’s built-in camera.')
    setPanelFitEpoch((n) => n + 1)
  }, [roomId])

  return (
    <div className="app" onPointerDown={() => unlockSfx()}>
      {endOutcome && !endgameDismissed && !drillOpen && (
        <EndGameOverlay
          outcome={endOutcome}
          onNewGame={reset}
          onDismiss={() => setEndgameDismissed(true)}
          onReviewGame={() => void reviewGame()}
          canReview={history.length > 0 && !importBusy}
          reviewBusy={reviewBusy}
          reviewProgress={reviewProgress}
          reviewError={reviewError}
        />
      )}

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => openPanel(null)}
        boardId={boardId}
        pieceSetId={pieceSetId}
        roomId={roomId}
        muted={muted}
        volume={volume}
        musicTrackId={musicTrackId}
        strength={strength}
        playerColor={playerColor}
        fen={fenDraft}
        showBestMove={showBestMove}
        bestMoveDelaySec={bestMoveDelaySec}
        showFps={showFps}
        showMoveIndicators={showMoveIndicators}
        onBoardChange={setBoardId}
        onPieceSetChange={setPieceSetId}
        onRoomChange={setRoomId}
        onMutedChange={setMutedState}
        onVolumeChange={setVolumeState}
        onMusicTrackChange={setMusicTrackId}
        onStrengthChange={onStrengthChange}
        onColorChange={onColorChange}
        onFenChange={onFenChange}
        onFenCommit={onFenCommit}
        onDumpView={dumpView}
        onSetDefaultAngle={setDefaultAngle}
        onClearDefaultAngle={clearDefaultAngle}
        hasDefaultAngle={defaultAngleSaved}
        defaultAngleStatus={defaultAngleStatus}
        onShowBestMoveChange={setShowBestMove}
        onBestMoveDelaySecChange={setBestMoveDelaySec}
        onShowFpsChange={setShowFps}
        onShowMoveIndicatorsChange={setShowMoveIndicators}
        panelWidth={panelWidth}
        onPanelWidthChange={onPanelWidthChange}
        onPanelResizeEnd={onPanelResizeEnd}
      />

      <AnalysisDialog
        open={analysisOpen}
        onClose={() => openPanel(null)}
        report={analysisReport}
        scrubIndex={scrubIndex}
        onScrubTo={scrubTo}
        analyzing={reviewBusy}
        analyzeProgress={reviewProgress}
        analyzeError={reviewError}
        onAskCoachRecap={() => void askCoachRecap()}
        coachRecapBusy={coachStatus === 'loading'}
        chessComUsername={chessComUsername}
        onChessComUsernameChange={(username) => {
          setChessComUsername(username)
          localStorage.setItem(CHESSCOM_USER_KEY, username)
        }}
        importDraft={importDraft}
        onImportDraftChange={setImportDraft}
        onImportGame={() => void importGame()}
        importBusy={importBusy}
        importError={importError}
        importStatus={importStatus}
        onReviewCurrent={() => void reviewGame()}
        canReviewCurrent={history.length > 0 && !importBusy}
        panelWidth={panelWidth}
        onPanelWidthChange={onPanelWidthChange}
        onPanelResizeEnd={onPanelResizeEnd}
      />

      <DrillDialog
        open={drillOpen}
        onClose={() => openPanel(null)}
        line={drillLine}
        plyIndex={drillPlyIndex}
        hint={
          drillLine
            ? hintForPly(drillLine, Math.min(drillPlyIndex, drillLine.moves.length - 1))
            : 'Pick a line to start practicing the Italian Opening.'
        }
        wrongFlash={drillWrongFlash || !!drillMistake}
        mistakeMessage={
          drillMistake
            ? `While fine, this course recommends playing ${recommendPhrase(drillMistake.expectedSan)}.`
            : null
        }
        onTryAgain={drillMistake ? retryDrillMistake : undefined}
        progress={drillProgress}
        onSelectLine={startDrillLine}
        onRestart={restartDrill}
        onShowHint={() => setDrillHintRevealed(true)}
        hintRevealed={drillHintRevealed}
        status={drillStatus}
        celebrate={drillStatus === 'complete' && !drillMistakes}
        onScrubPly={scrubDrillTo}
        scrubMax={drillReview?.history.length ?? 0}
        panelWidth={panelWidth}
        onPanelWidthChange={onPanelWidthChange}
        onPanelResizeEnd={onPanelResizeEnd}
        openingCardBlurb={openingCard?.blurb ?? null}
        openingCardStatus={openingCardStatus}
        coachExplanation={coachExplanation}
        coachStatus={coachStatus}
        coachError={coachError}
        coachChat={coachChat}
        coachChatStatus={coachChatStatus}
        coachChatError={coachChatError}
        onSendCoachChat={sendCoachChat}
      />

      <GamePanel
        open={gameOpen}
        onClose={() => openPanel(null)}
        onNewGame={reset}
        tab={gameTab}
        onTabChange={setGameTab}
        history={fenHistory}
        playerColor={playerColor}
        explanation={coachExplanation}
        coachStatus={coachStatus}
        coachError={coachError}
        chatMessages={coachChat}
        chatStatus={coachChatStatus}
        chatError={coachChatError}
        onSendChat={sendCoachChat}
        isPlayerTurn={turn === playerColor}
        reviewMode={coachReviewMode}
        panelWidth={panelWidth}
        onPanelWidthChange={onPanelWidthChange}
        onPanelResizeEnd={onPanelResizeEnd}
      />

      <div className="layout">
        <section className="stage">
          <header className="hud">
            <div className="hud-cluster">
              <div className="hud-brand">
                <p className="eyebrow">3D Chess</p>
                <p className="status">{status}</p>
                {reviewImport && (
                  <div className="hud-scrub" role="group" aria-label="Move scrub">
                    <PixelButton
                      ghost
                      disabled={scrubIndex <= 0}
                      onClick={() => scrubTo(scrubIndex - 1)}
                      aria-label="Previous ply"
                    >
                      ‹
                    </PixelButton>
                    <span className="hud-scrub-label">
                      {scrubIndex}/{reviewImport.history.length}
                    </span>
                    <PixelButton
                      ghost
                      disabled={scrubIndex >= reviewImport.history.length}
                      onClick={() => scrubTo(scrubIndex + 1)}
                      aria-label="Next ply"
                    >
                      ›
                    </PixelButton>
                    <PixelButton
                      ghost
                      disabled={scrubIndex === 0}
                      onClick={() => scrubTo(0)}
                      aria-label="Start position"
                    >
                      Start
                    </PixelButton>
                    <PixelButton
                      ghost
                      disabled={scrubIndex === reviewImport.history.length}
                      onClick={() => scrubTo(reviewImport.history.length)}
                      aria-label="Final position"
                    >
                      End
                    </PixelButton>
                  </div>
                )}
              </div>
              <div
                className="fps-slot"
                ref={fpsParentRef}
                hidden={!showFps}
                aria-hidden={!showFps}
              />
              <HudEval
                fen={fen}
                best={best}
                analysisStatus={analysisStatus}
              />
            </div>
            <div className="hud-orbit">
              <GradientButtonGroup
                layoutGroupId="hud-orbit"
                ariaLabel="Camera drag mode"
                activeId={orbitDragMode}
                items={[
                  {
                    id: 'move',
                    label: 'Drag pieces',
                    icon: (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 4l7.07 17 2.51-7.39L21 11.07 4 4z" />
                      </svg>
                    ),
                    onClick: () => setOrbitDragMode('move'),
                  },
                  {
                    id: 'rotate',
                    label: 'Drag to rotate',
                    icon: (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M21 12a9 9 0 1 1-3.5-7.1" />
                        <path d="M21 3v6h-6" />
                      </svg>
                    ),
                    onClick: () => setOrbitDragMode('rotate'),
                  },
                  {
                    id: 'pan',
                    label: 'Drag to pan',
                    icon: (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M5 9l-3 3 3 3" />
                        <path d="M9 5l3-3 3 3" />
                        <path d="M15 19l-3 3-3-3" />
                        <path d="M19 9l3 3-3 3" />
                        <path d="M2 12h20" />
                        <path d="M12 2v20" />
                      </svg>
                    ),
                    onClick: () => setOrbitDragMode('pan'),
                  },
                ]}
              />
            </div>
            <div className="hud-actions">
              <GradientButtonGroup
                layoutGroupId="hud-game"
                ariaLabel="Game actions"
                activeId={panel ?? undefined}
                items={[
                  {
                    id: 'settings',
                    label: 'Settings',
                    icon: (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ),
                    onClick: () =>
                      openPanel(panel === 'settings' ? null : 'settings'),
                  },
                  {
                    id: 'undo',
                    label: 'Undo',
                    icon: (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 7v6h6" />
                        <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.36 2.64L3 13" />
                      </svg>
                    ),
                    onClick: onUndo,
                    disabled: urlHistoryIndex <= 0 || opponentThinking,
                  },
                  {
                    id: 'analysis',
                    label: 'Analysis',
                    icon: (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 19V5" />
                        <path d="M4 19h16" />
                        <path d="M8 15v-3" />
                        <path d="M12 15V8" />
                        <path d="M16 15v-6" />
                      </svg>
                    ),
                    onClick: () =>
                      openPanel(panel === 'analysis' ? null : 'analysis'),
                  },
                  {
                    id: 'drill',
                    label: 'Drill',
                    icon: (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 19 15 8" />
                        <path d="m14 7 3 3" />
                        <path d="M12 19h8" />
                        <path d="m5 12 3 3" />
                        <circle cx="6.5" cy="6.5" r="2.5" />
                      </svg>
                    ),
                    onClick: () =>
                      openPanel(panel === 'drill' ? null : 'drill'),
                  },
                  {
                    id: 'game',
                    label: 'Game',
                    icon: (
                      <Joystick
                        size={18}
                        strokeWidth={2.25}
                        aria-hidden="true"
                      />
                    ),
                    onClick: () => {
                      if (coachStatus === 'error') {
                        setCoachStatus('idle')
                        setCoachError(null)
                      }
                      openPanel(panel === 'game' ? null : 'game')
                    },
                  },
                ]}
              />
            </div>
          </header>

          <Canvas
            shadows={{ type: THREE.PCFShadowMap }}
            dpr={[1, 1.5]}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
            camera={{
              position: roomTheme.cameraPosition ?? DEFAULT_CAMERA_POS,
              fov: roomTheme.cameraFov ?? 40,
            }}
          >
            {showFps && (
              <Stats
                className="fps-meter"
                parent={fpsParentRef as React.RefObject<HTMLElement>}
              />
            )}
            <RoomCamera
              roomId={roomTheme.id}
              position={roomTheme.cameraPosition ?? DEFAULT_CAMERA_POS}
              fov={roomTheme.cameraFov ?? 40}
              target={roomTheme.boardOffset ?? DEFAULT_CAMERA_TARGET}
            />
            <PanelViewFit
              active={rightPanelOpen}
              panelWidth={panelWidth}
              fitEpoch={panelFitEpoch}
              boardOrigin={roomTheme.boardOffset ?? DEFAULT_CAMERA_TARGET}
              sceneKey={`${roomId}:${boardId}:${pieceSetId}:${drillOpen ? 'drill' : 'play'}`}
              roomId={roomId}
            />
            <color attach="background" args={[roomTheme.background]} />
            <Environment files={roomTheme.hdr} environmentIntensity={0.6} />
            <RoomScene theme={roomTheme} />
            <group position={roomTheme.boardOffset ?? DEFAULT_CAMERA_TARGET}>
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
                wrongFrom={drillMistake?.from ?? null}
                wrongTo={drillMistake?.to ?? null}
                pendingEngineMove={pendingEngineMove}
                onEngineMoveConsumed={onEngineMoveConsumed}
                boardTheme={boardTheme}
                pieceSet={pieceSet}
                roomTheme={roomTheme}
                boardId={boardId}
                pieceSetId={pieceSetId}
                orbitDragMode={orbitDragMode}
                showMoveIndicators={showMoveIndicators}
                readOnly={
                  !!reviewImport ||
                  drillStatus === 'complete' ||
                  !!drillMistake
                }
                validateMove={
                  drillStatus === 'playing' ? validateDrillMove : undefined
                }
              />
            </group>
          </Canvas>
        </section>
      </div>
    </div>
  )
}
