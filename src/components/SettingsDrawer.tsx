import type { FC } from 'react'
import {
  BOARD_KEY,
  BOARD_THEMES,
  BOARD_VIEW_KEY,
  BEST_MOVE_DELAY_KEY,
  BEST_MOVE_KEY,
  FPS_KEY,
  MOVE_INDICATORS_KEY,
  PIECE_KEY,
  PIECE_SETS,
  ROOM_KEY,
  ROOM_THEMES,
  type AutoFlipMode,
  type BoardView,
} from '@/lib/themes'
import { setMuted, setVolume, unlockSfx } from '@/lib/sfx'
import {
  STRENGTH_LEVELS,
  type StrengthLevel,
} from '@/lib/stockfishOpponent'
import type { GameMode } from '@/lib/playMode'
import { AnimatedSwitch } from '@/components/ui/animated-switch'
import { PixelButton } from '@/components/ui/PixelButton'
import { PanelResizeHandle } from '@/components/PanelResizeHandle'

type Props = {
  open: boolean
  onClose: () => void
  boardId: string
  boardView: BoardView
  pieceSetId: string
  roomId: string
  muted: boolean
  volume: number
  strength: StrengthLevel
  gameMode: GameMode
  autoFlip: AutoFlipMode
  fen: string
  showBestMove: boolean
  bestMoveDelaySec: number
  showFps: boolean
  showMoveIndicators: boolean
  onBoardChange: (id: string) => void
  onBoardViewChange: (view: BoardView) => void
  onPieceSetChange: (id: string) => void
  onRoomChange: (id: string) => void
  onMutedChange: (muted: boolean) => void
  onVolumeChange: (volume: number) => void
  onStrengthChange: (level: StrengthLevel) => void
  onGameModeChange: (mode: GameMode) => void
  onAutoFlipChange: (mode: AutoFlipMode) => void
  onFenChange: (fen: string) => void
  onFenCommit: () => void
  onDumpView: () => void
  onSetDefaultAngle: () => void
  onClearDefaultAngle: () => void
  hasDefaultAngle: boolean
  defaultAngleStatus?: string | null
  onShowBestMoveChange: (show: boolean) => void
  onBestMoveDelaySecChange: (sec: number) => void
  onShowFpsChange: (show: boolean) => void
  onShowMoveIndicatorsChange: (show: boolean) => void
  panelWidth: number
  onPanelWidthChange: (width: number) => void
  onPanelResizeEnd?: (width: number) => void
}

function ThemeStrip<
  T extends { id: string; name: string; previewColor: string; preview?: string }
>({
  label,
  items,
  selectedId,
  onSelect,
}: {
  label: string
  items: T[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <section className="settings-section">
      <h3>{label}</h3>
      <div className="theme-strip">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`theme-card${selectedId === item.id ? ' active' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            {item.preview ? (
              <img
                className="theme-swatch"
                src={item.preview}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            ) : (
              <span
                className="theme-swatch"
                style={{ background: item.previewColor }}
              />
            )}
            <span className="theme-name">{item.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export const SettingsDrawer: FC<Props> = ({
  open,
  onClose,
  boardId,
  boardView,
  pieceSetId,
  roomId,
  muted,
  volume,
  strength,
  gameMode,
  autoFlip,
  fen,
  showBestMove,
  bestMoveDelaySec,
  showFps,
  showMoveIndicators,
  onBoardChange,
  onBoardViewChange,
  onPieceSetChange,
  onRoomChange,
  onMutedChange,
  onVolumeChange,
  onStrengthChange,
  onGameModeChange,
  onAutoFlipChange,
  onFenChange,
  onFenCommit,
  onDumpView,
  onSetDefaultAngle,
  onClearDefaultAngle,
  hasDefaultAngle,
  defaultAngleStatus = null,
  onShowBestMoveChange,
  onBestMoveDelaySecChange,
  onShowFpsChange,
  onShowMoveIndicatorsChange,
  panelWidth,
  onPanelWidthChange,
  onPanelResizeEnd,
}) => {
  if (!open) return null

  const levelCfg = STRENGTH_LEVELS[strength]

  return (
    <div className="settings-backdrop" role="presentation">
      <aside
        className="settings-drawer"
        role="dialog"
        aria-label="Game settings"
      >
        <PanelResizeHandle
          width={panelWidth}
          onWidthChange={onPanelWidthChange}
          onResizeEnd={onPanelResizeEnd}
        />
        <header className="settings-header">
          <h2>Settings</h2>
          <PixelButton ghost onClick={onClose}>
            Close
          </PixelButton>
        </header>

        <section className="settings-section">
          <h3>Board view</h3>
          <div
            className="board-view-switch"
            role="radiogroup"
            aria-label="Board view"
          >
            {(['3d', '2d'] as const).map((view) => (
              <button
                key={view}
                type="button"
                role="radio"
                aria-checked={boardView === view}
                className={`board-view-option${boardView === view ? ' active' : ''}`}
                onClick={() => {
                  localStorage.setItem(BOARD_VIEW_KEY, view)
                  onBoardViewChange(view)
                }}
              >
                {view === '3d' ? '3D' : '2D'}
              </button>
            ))}
          </div>
          <p className="settings-import-status">
            2D is a flat green and cream board. 3D keeps the room. Switching
            leaves the position where it is.
          </p>
        </section>

        <section className="settings-section">
          <h3>Mode</h3>
          <div
            className="board-view-switch"
            role="radiogroup"
            aria-label="Game mode"
          >
            {(
              [
                { id: 'computer', label: 'vs Computer' },
                { id: 'pvp', label: 'Two players' },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={gameMode === option.id}
                className={`board-view-option${gameMode === option.id ? ' active' : ''}`}
                onClick={() => onGameModeChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="settings-import-status">
            {gameMode === 'pvp'
              ? 'Two people share the board. Both colors are played by hand.'
              : 'You play one color and Stockfish plays the other.'}
          </p>
        </section>

        {gameMode === 'pvp' && (
          <section className="settings-section">
            <h3>Auto flip</h3>
            <div
              className="board-view-switch auto-flip-switch"
              role="radiogroup"
              aria-label="Auto flip"
            >
              {(
                [
                  { id: 'off', label: 'Off' },
                  { id: 'board', label: 'Flip board' },
                  { id: 'pieces', label: 'Flip pieces' },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={autoFlip === option.id}
                  className={`board-view-option${autoFlip === option.id ? ' active' : ''}`}
                  onClick={() => onAutoFlipChange(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="settings-import-status">
              {autoFlip === 'board'
                ? 'The whole board turns to whoever is to move.'
                : autoFlip === 'pieces'
                  ? 'The board stays still; the 3D pieces turn to whoever is to move.'
                  : 'The board stays put all game.'}
            </p>
          </section>
        )}

        {gameMode === 'computer' && (
          <section className="settings-section">
            <h3>Opponent</h3>
            <label className="slider-label" htmlFor="settings-strength">
              Strength — level <strong>{strength}</strong>
              <span className="elo-hint">({levelCfg.eloHint} Elo)</span>
            </label>
            <input
              id="settings-strength"
              className="slider"
              type="range"
              min={1}
              max={8}
              step={1}
              value={strength}
              onChange={(e) =>
                onStrengthChange(Number(e.target.value) as StrengthLevel)
              }
            />
            <div className="slider-ends">
              <span>1 weak</span>
              <span>8 strong</span>
            </div>
          </section>
        )}

        <section className="settings-section">
          <h3>Hints</h3>
          <div className="settings-row">
            <span id="settings-move-indicators-label">Show move indicators</span>
            <AnimatedSwitch
              checked={showMoveIndicators}
              aria-labelledby="settings-move-indicators-label"
              onCheckedChange={(next) => {
                localStorage.setItem(MOVE_INDICATORS_KEY, next ? '1' : '0')
                onShowMoveIndicatorsChange(next)
              }}
            />
          </div>
          <div className="settings-row">
            <span id="settings-best-move-label">Show best move</span>
            <AnimatedSwitch
              checked={showBestMove}
              aria-labelledby="settings-best-move-label"
              onCheckedChange={(next) => {
                localStorage.setItem(BEST_MOVE_KEY, next ? '1' : '0')
                onShowBestMoveChange(next)
              }}
            />
          </div>
          {showBestMove && (
            <>
              <label className="slider-label" htmlFor="settings-best-move-delay">
                Best move delay — <strong>{bestMoveDelaySec}s</strong>
              </label>
              <input
                id="settings-best-move-delay"
                className="slider"
                type="range"
                min={0}
                max={30}
                step={1}
                value={bestMoveDelaySec}
                onChange={(e) => {
                  const next = Number(e.target.value)
                  localStorage.setItem(BEST_MOVE_DELAY_KEY, String(next))
                  onBestMoveDelaySecChange(next)
                }}
              />
              <div className="slider-ends">
                <span>0s instant</span>
                <span>30s</span>
              </div>
            </>
          )}
          <div className="settings-row">
            <span id="settings-fps-label">Show FPS</span>
            <AnimatedSwitch
              checked={showFps}
              aria-labelledby="settings-fps-label"
              onCheckedChange={(next) => {
                localStorage.setItem(FPS_KEY, next ? '1' : '0')
                onShowFpsChange(next)
              }}
            />
          </div>
        </section>

        <ThemeStrip
          label="Board"
          items={BOARD_THEMES}
          selectedId={boardId}
          onSelect={(id) => {
            localStorage.setItem(BOARD_KEY, id)
            onBoardChange(id)
          }}
        />
        <ThemeStrip
          label="Pieces"
          items={PIECE_SETS}
          selectedId={pieceSetId}
          onSelect={(id) => {
            localStorage.setItem(PIECE_KEY, id)
            onPieceSetChange(id)
          }}
        />
        <ThemeStrip
          label="Room"
          items={ROOM_THEMES}
          selectedId={roomId}
          onSelect={(id) => {
            localStorage.setItem(ROOM_KEY, id)
            onRoomChange(id)
          }}
        />

        <section className="settings-section">
          <h3>Sound</h3>
          <div className="settings-row">
            <span id="settings-mute-label">Sound effects</span>
            <AnimatedSwitch
              checked={!muted}
              aria-labelledby="settings-mute-label"
              onCheckedChange={(next) => {
                const nextMuted = !next
                setMuted(nextMuted)
                onMutedChange(nextMuted)
              }}
            />
          </div>
          <label className="slider-label settings-volume">
            Volume
            <input
              className="slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              disabled={muted}
              onChange={(e) => {
                unlockSfx()
                const v = Number(e.target.value)
                setVolume(v)
                onVolumeChange(v)
              }}
            />
          </label>
        </section>

        <section className="settings-section">
          <h3>Position (FEN)</h3>
          <textarea
            className="settings-fen"
            value={fen}
            onChange={(e) => onFenChange(e.target.value)}
            onBlur={onFenCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onFenCommit()
              }
            }}
            rows={3}
            spellCheck={false}
          />
        </section>

        <section className="settings-section">
          <h3>Camera</h3>
          <PixelButton
            ghost
            className="settings-full-btn"
            onClick={onSetDefaultAngle}
          >
            Set default angle
          </PixelButton>
          {hasDefaultAngle ? (
            <PixelButton
              ghost
              className="settings-full-btn"
              onClick={onClearDefaultAngle}
            >
              Clear default angle
            </PixelButton>
          ) : null}
          {defaultAngleStatus ? (
            <p className="settings-import-status">{defaultAngleStatus}</p>
          ) : (
            <p className="settings-import-status">
              Saves the current view for this room (used when the sidebar
              refits).
            </p>
          )}
        </section>

        <section className="settings-section">
          <h3>Developer</h3>
          <PixelButton
            ghost
            className="settings-full-btn"
            onClick={onDumpView}
          >
            Dump view
          </PixelButton>
        </section>

        <p className="settings-credit">
          Credits:{' '}
          <a
            href="https://sketchfab.com/3d-models/modern-dining-room-df3f3c9f6233447eb8b7ee129f3bace5"
            target="_blank"
            rel="noreferrer"
          >
            Dining room
          </a>
          {' · '}
          <a
            href="https://sketchfab.com/3d-models/the-simpsons-living-room-24f9058a77ef4f9ab172d6d06954bc82"
            target="_blank"
            rel="noreferrer"
          >
            Simpsons living room
          </a>
          {' · '}
          <a
            href="https://sketchfab.com/3d-models/retropc-chess-31e657b251b546e69e6ae312fc0bf66a"
            target="_blank"
            rel="noreferrer"
          >
            Retro PC chess
          </a>
          {' · '}
          <a
            href="https://sketchfab.com/3d-models/chess-board-a0d61768bc504082901728ec9603fa0d"
            target="_blank"
            rel="noreferrer"
          >
            Glass chess (Al)
          </a>
          {' · '}
          <a
            href="https://sketchfab.com/3d-models/chess-set-89509e3c894c40a68542bdc586b38c9c"
            target="_blank"
            rel="noreferrer"
          >
            Low Poly chess set
          </a>
          {' · '}
          <a
            href="https://sketchfab.com/3d-models/chess-e54c2d04d4f74823b69ba4a794fb4500"
            target="_blank"
            rel="noreferrer"
          >
            Ornate chess (Verfassen)
          </a>
        </p>
      </aside>
    </div>
  )
}
