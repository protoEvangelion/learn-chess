import { useEffect, useMemo, useRef, useState, type FC } from 'react'
import { Eraser, RotateCcw } from 'lucide-react'
import { createPiece, type Color, type PieceType } from '@logic/pieces'
import { createTile, type Board } from '@logic/board'
import { fenToGame } from '@/lib/fenBridge'
import { PixelButton } from '@/components/ui/PixelButton'

type Props = {
  open: boolean
  /** FEN to start from. Usually the reviewed position. */
  fen: string
  onClose: () => void
  /** Apply the edited position to the board. */
  onApply: (fen: string) => void
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const PIECE_TYPES: PieceType[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']
type Selected = { type: PieceType; color: Color } | 'trash' | null

function sprite(type: PieceType, color: Color) {
  return `/assets/pieces-2d/${type}-${color === 'white' ? 'w' : 'b'}.svg`
}

/** Plain editor FEN: no castling or en-passant claims until the side moves. */
function editorFen(board: Board, turn: Color) {
  const rows: string[] = []
  for (let y = 0; y < 8; y += 1) {
    let empty = 0
    let row = ''
    for (let x = 0; x < 8; x += 1) {
      const piece = board[y][x].piece
      if (!piece) {
        empty += 1
        continue
      }
      if (empty) {
        row += String(empty)
        empty = 0
      }
      const letter = piece.type === 'knight' ? 'n' : piece.type[0]
      row += piece.color === 'white' ? letter.toUpperCase() : letter
    }
    if (empty) row += String(empty)
    rows.push(row || '8')
  }
  return `${rows.join('/')} ${turn === 'white' ? 'w' : 'b'} - - 0 1`
}

function emptyBoard(): Board {
  const board: Board = []
  for (let y = 0; y < 8; y += 1) {
    const row = []
    for (let x = 0; x < 8; x += 1) row.push(createTile({ x, y }))
    board.push(row)
  }
  return board
}

export const EditBoardDialog: FC<Props> = ({ open, fen, onClose, onApply }) => {
  const [board, setBoard] = useState<Board>(() => fenToGame(fen)?.board ?? emptyBoard())
  const [turn, setTurn] = useState<Color>(() => (fen.split(/\s+/)[1] === 'b' ? 'black' : 'white'))
  const [selected, setSelected] = useState<Selected>(null)
  const idRef = useRef(1000)

  useEffect(() => {
    if (!open) return
    const parsed = fenToGame(fen)
    setBoard(parsed?.board ?? emptyBoard())
    setTurn(fen.split(/\s+/)[1] === 'b' ? 'black' : 'white')
    setSelected(null)
  }, [open, fen])

  const nextFen = useMemo(() => editorFen(board, turn), [board, turn])

  if (!open) return null

  function place(x: number, y: number) {
    if (selected === 'trash') {
      setBoard((prev) => {
        const next = prev.map((row) => row.map((tile) => ({ ...tile, piece: tile.piece ? { ...tile.piece } : null })))
        next[y][x].piece = null
        return next
      })
      return
    }
    if (!selected) return
    setBoard((prev) => {
      const next = prev.map((row) => row.map((tile) => ({ ...tile, piece: tile.piece ? { ...tile.piece } : null })))
      idRef.current += 1
      next[y][x].piece = createPiece({
        type: selected.type,
        color: selected.color,
        id: idRef.current,
        position: { x, y },
      })
      return next
    })
  }

  function reset() {
    const parsed = fenToGame(fen)
    setBoard(parsed?.board ?? emptyBoard())
    setTurn(fen.split(/\s+/)[1] === 'b' ? 'black' : 'white')
    setSelected(null)
  }

  function clear() {
    setBoard(emptyBoard())
    setSelected(null)
  }

  return (
    <div
      className="edit-board-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="edit-board-card" role="dialog" aria-modal="true" aria-label="Edit board">
        <header className="edit-board-header">
          <div>
            <p className="edit-board-eyebrow">Review</p>
            <h2>Edit board</h2>
          </div>
          <PixelButton ghost onClick={onClose}>
            Cancel
          </PixelButton>
        </header>

        <div className="edit-board-body">
          <div className="edit-board-main">
            <div className="edit-board-grid" role="grid" aria-label="Edit board">
              {board.map((row, y) =>
                row.map((tile, x) => {
                  const piece = tile.piece
                  return (
                    <button
                      key={`${x}-${y}`}
                      type="button"
                      role="gridcell"
                      className={`edit-square ${(x + y) % 2 === 1 ? 'is-dark' : ''}${selected === 'trash' ? ' is-erasing' : ''}`}
                      aria-label={`${FILES[x]}${8 - y}${piece ? ` ${piece.color} ${piece.type}` : ' empty'}`}
                      onClick={() => place(x, y)}
                    >
                      {piece ? (
                        <img src={sprite(piece.type, piece.color)} alt="" draggable={false} />
                      ) : null}
                      {y === 7 ? <span className="edit-file">{FILES[x]}</span> : null}
                      {x === 0 ? <span className="edit-rank">{8 - y}</span> : null}
                    </button>
                  )
                }),
              )}
            </div>
          </div>

          <aside className="edit-board-side">
            <section>
              <h3>Pieces</h3>
              {(['white', 'black'] as const).map((color) => (
                <div key={color} className="edit-palette">
                  {PIECE_TYPES.map((type) => {
                    const active =
                      selected !== 'trash' && selected?.type === type && selected?.color === color
                    return (
                      <button
                        key={type}
                        type="button"
                        className={`edit-palette-btn${active ? ' is-active' : ''}`}
                        aria-label={`${color} ${type}`}
                        aria-pressed={active}
                        onClick={() => setSelected({ type, color })}
                      >
                        <img src={sprite(type, color)} alt="" draggable={false} />
                      </button>
                    )
                  })}
                </div>
              ))}
              <button
                type="button"
                className={`edit-palette-btn is-trash${selected === 'trash' ? ' is-active' : ''}`}
                aria-label="Remove piece"
                aria-pressed={selected === 'trash'}
                onClick={() => setSelected('trash')}
              >
                <Eraser size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </section>

            <section>
              <h3>Side to move</h3>
              <div className="edit-side-toggle" role="radiogroup" aria-label="Side to move">
                {(['white', 'black'] as const).map((color) => (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={turn === color}
                    className={`edit-side-btn${turn === color ? ' is-active' : ''}`}
                    onClick={() => setTurn(color)}
                  >
                    {color === 'white' ? 'White' : 'Black'}
                  </button>
                ))}
              </div>
            </section>

            <section className="edit-board-actions">
              <PixelButton ghost onClick={reset}>
                <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" /> Reset
              </PixelButton>
              <PixelButton ghost onClick={clear}>
                Clear
              </PixelButton>
            </section>

            <p className="edit-board-hint">
              Pick a piece, then click a square. Pick the eraser to remove a piece.
            </p>
          </aside>
        </div>

        <footer className="edit-board-footer">
          <code className="edit-board-fen">{nextFen}</code>
          <PixelButton
            onClick={() => {
              onApply(nextFen)
              onClose()
            }}
          >
            Apply position
          </PixelButton>
        </footer>
      </div>
    </div>
  )
}
