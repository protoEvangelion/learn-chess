import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { createBoard } from '@logic/board'
import type { Board } from '@logic/board'
import type { Color, Move, Piece } from '@logic/pieces'
import { getTile, movesForPiece } from '@logic/pieces'
import { BoardComponent, type GameOver } from '@/components/Board'
import { Sidebar } from '@/components/Sidebar'
import { Border } from '@models/Border'
import { useGameState } from '@/state/game'
import { boardToFen, squareToPosition } from '@/lib/fenBridge'
import {
  stockfishOpponent,
  type BestMoveResult,
  type StrengthLevel,
} from '@/lib/stockfishOpponent'
import { EndGameOverlay, outcomeFromResult } from '@/EndGameOverlay'
import './App.css'

const STRENGTH_KEY = 'chess-3d:strength'
const COLOR_KEY = 'chess-3d:playerColor'
const COACH_KEY = 'chess-3d:coachEnabled'

function loadStrength(): StrengthLevel {
  const raw = Number(localStorage.getItem(STRENGTH_KEY) ?? 3)
  if (raw >= 1 && raw <= 8) return raw as StrengthLevel
  return 3
}

function loadPlayerColor(): Color {
  return localStorage.getItem(COLOR_KEY) === 'black' ? 'black' : 'white'
}

function loadCoachEnabled(): boolean {
  const saved = localStorage.getItem(COACH_KEY)
  if (saved === null) return true
  return saved !== '0' && saved !== 'false'
}

export default function App() {
  const [board, setBoard] = useState<Board>(() => createBoard())
  const [selected, setSelected] = useState<Piece | null>(null)
  const [moves, setMoves] = useState<Move[]>([])
  const [gameOver, setGameOver] = useState<GameOver | null>(null)
  const [endgameDismissed, setEndgameDismissed] = useState(false)
  const [playerColor, setPlayerColor] = useState<Color>(loadPlayerColor)
  const [strength, setStrength] = useState<StrengthLevel>(loadStrength)
  const [coachEnabled, setCoachEnabled] = useState(loadCoachEnabled)
  const [best, setBest] = useState<BestMoveResult | null>(null)
  const [analysisStatus, setAnalysisStatus] = useState<
    'idle' | 'loading' | 'error'
  >('idle')
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [coachNote, setCoachNote] = useState('')
  const [coachStatus, setCoachStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle',
  )
  const [coachError, setCoachError] = useState<string | null>(null)
  const [opponentThinking, setOpponentThinking] = useState(false)
  const [pendingEngineMove, setPendingEngineMove] = useState<Move | null>(null)
  const skipEngineOnce = useRef(false)
  const coachAbortRef = useRef<AbortController | null>(null)

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
  useEffect(() => {
    if (!gameOver) setEndgameDismissed(false)
  }, [gameOver])

  const tipFrom =
    coachEnabled && best ? squareToPosition(best.from) : null
  const tipTo = coachEnabled && best ? squareToPosition(best.to) : null

  const endOutcome = outcomeFromResult(gameOver, playerColor)

  // Analysis for coach tips
  useEffect(() => {
    if (gameOver) {
      setBest(null)
      return
    }
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
  }, [fen, gameOver])

  useEffect(() => {
    coachAbortRef.current?.abort()
    coachAbortRef.current = null
    setCoachNote('')
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

  async function askCoach() {
    if (!best || !coachEnabled || coachStatus === 'loading') return
    coachAbortRef.current?.abort()
    const controller = new AbortController()
    coachAbortRef.current = controller
    setCoachStatus('loading')
    setCoachError(null)
    setCoachNote('')

    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          fen,
          bestMove: best.uci,
          from: best.from,
          to: best.to,
          evalLabel: best.evalLabel,
          line: best.line,
        }),
      })
      if (!res.ok || !res.body) throw new Error(`Explain failed (${res.status})`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
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
            setCoachNote((prev) => prev + payload.text!)
          } else if (payload.type === 'done') {
            if (payload.text) setCoachNote(payload.text)
          } else if (payload.type === 'error') {
            throw new Error(payload.error || 'Explain failed')
          }
        }
      }
      setCoachStatus('idle')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setCoachStatus('error')
      setCoachError(err instanceof Error ? err.message : 'Ask coach failed')
    }
  }

  function reset() {
    skipEngineOnce.current = playerColor === 'black'
    setBoard(createBoard())
    setSelected(null)
    setMoves([])
    setGameOver(null)
    setEndgameDismissed(false)
    setMovingTo(null)
    setPendingEngineMove(null)
    setBest(null)
    resetHistory()
    resetTurn()
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

  function onCoachToggle(enabled: boolean) {
    setCoachEnabled(enabled)
    localStorage.setItem(COACH_KEY, enabled ? '1' : '0')
  }

  function onUndo() {
    const hist = useGameState.getState().history
    if (hist.length === 0 || opponentThinking || movingTo) return
    const last = hist[hist.length - 1]
    useGameState.setState({
      history: hist.slice(0, -1),
      turn: last.piece.color,
      movingTo: null,
    })
    setBoard(last.board)
    setSelected(null)
    setMoves([])
    setGameOver(null)
    setPendingEngineMove(null)
    skipEngineOnce.current = last.piece.color !== playerColor
  }

  const onEngineMoveConsumed = useCallback(() => {
    setPendingEngineMove(null)
  }, [])

  const status = useMemo(() => {
    if (gameOver) return `${gameOver.winner} wins (${gameOver.type})`
    if (opponentThinking) return `Opponent thinking…`
    return `${turn} to move`
  }, [gameOver, opponentThinking, turn])

  return (
    <div className="app">
      {endOutcome && !endgameDismissed && (
        <EndGameOverlay
          outcome={endOutcome}
          onNewGame={reset}
          onDismiss={() => setEndgameDismissed(true)}
        />
      )}

      <div className="layout">
        <section className="stage">
          <header className="hud">
            <div>
              <p className="eyebrow">3D Chess</p>
              <p className="status">{status}</p>
            </div>
            <button type="button" onClick={reset}>
              New game
            </button>
          </header>

          <Canvas shadows camera={{ position: [-12, 5, 6], fov: 50 }}>
            <color attach="background" args={['#0b0b0b']} />
            <Environment files="/dawn.hdr" />
            <Border />
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
            />
          </Canvas>
        </section>

        <Sidebar
          fen={fenDraft}
          turn={turn}
          playerColor={playerColor}
          strength={strength}
          coachEnabled={coachEnabled}
          best={best}
          analysisStatus={analysisStatus}
          analysisError={analysisError}
          coachNote={coachNote}
          coachStatus={coachStatus}
          coachError={coachError}
          opponentThinking={opponentThinking}
          gameOverLabel={
            gameOver ? `${gameOver.winner} wins by ${gameOver.type}` : null
          }
          canUndo={history.length > 0}
          onStrengthChange={onStrengthChange}
          onColorChange={onColorChange}
          onCoachToggle={onCoachToggle}
          onAskCoach={askCoach}
          onUndo={onUndo}
          onNewGame={reset}
          onFenChange={setFenDraft}
        />
      </div>
    </div>
  )
}
