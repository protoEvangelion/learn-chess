import type { Board, Position } from '@logic/board'
import type { Color, Move, MoveTypes, Piece } from '@logic/pieces'
import { oppositeColor } from '@logic/pieces'
import type { Tile } from '@logic/board'
import { create } from 'zustand'

export type HistoryItem = {
  board: Board
  from: Position
  to: Position
  capture: Piece | null
  type: MoveTypes
  steps: Position
  piece: Piece
}

export type MovingTo = {
  move: Move
  tile: Tile
}

export const useGameState = create<{
  turn: Color
  setTurn: () => void
  resetTurn: () => void
  movingTo: MovingTo | null
  setMovingTo: (move: MovingTo | null) => void
  history: HistoryItem[]
  addHistory: (item: HistoryItem) => void
  resetHistory: () => void
}>((set) => ({
  turn: 'white',
  setTurn: () => set((s) => ({ turn: oppositeColor(s.turn) })),
  resetTurn: () => set({ turn: 'white' }),
  movingTo: null,
  setMovingTo: (movingTo) => set({ movingTo }),
  history: [],
  addHistory: (item) => set((s) => ({ history: [...s.history, item] })),
  resetHistory: () => set({ history: [] }),
}))

/** Alias used by pawn en passant logic. */
export const useHistoryState = {
  getState: () => ({ history: useGameState.getState().history }),
}
