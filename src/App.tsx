import { useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { createBoard } from '@logic/board'
import type { Board } from '@logic/board'
import type { Move, Piece } from '@logic/pieces'
import { BoardComponent, type GameOver } from '@/components/Board'
import { Border } from '@models/Border'
import { useGameState } from '@/state/game'
import './App.css'

export default function App() {
  const [board, setBoard] = useState<Board>(() => createBoard())
  const [selected, setSelected] = useState<Piece | null>(null)
  const [moves, setMoves] = useState<Move[]>([])
  const [gameOver, setGameOver] = useState<GameOver | null>(null)
  const turn = useGameState((s) => s.turn)
  const resetTurn = useGameState((s) => s.resetTurn)
  const resetHistory = useGameState((s) => s.resetHistory)
  const setMovingTo = useGameState((s) => s.setMovingTo)

  const status = useMemo(() => {
    if (gameOver) return `${gameOver.winner} wins (${gameOver.type})`
    return `${turn} to move — click a piece, then a highlighted square`
  }, [gameOver, turn])

  function reset() {
    setBoard(createBoard())
    setSelected(null)
    setMoves([])
    setGameOver(null)
    setMovingTo(null)
    resetHistory()
    resetTurn()
  }

  return (
    <div className="app">
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
        />
      </Canvas>
    </div>
  )
}
