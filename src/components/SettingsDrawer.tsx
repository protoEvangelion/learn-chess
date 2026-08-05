import type { FC } from 'react'
import {
  BOARD_KEY,
  BOARD_THEMES,
  BEST_MOVE_KEY,
  FPS_KEY,
  PIECE_KEY,
  PIECE_SETS,
  ROOM_KEY,
  ROOM_THEMES,
} from '@/lib/themes'
import { setMuted, setVolume, unlockSfx } from '@/lib/sfx'
import {
  STRENGTH_LEVELS,
  type StrengthLevel,
} from '@/lib/stockfishOpponent'
import type { Color } from '@logic/pieces'
import { AnimatedSwitch } from '@/components/ui/animated-switch'
import { PixelButton } from '@/components/ui/PixelButton'

type Props = {
  open: boolean
  onClose: () => void
  boardId: string
  pieceSetId: string
  roomId: string
  muted: boolean
  volume: number
  strength: StrengthLevel
  playerColor: Color
  fen: string
  showBestMove: boolean
  showFps: boolean
  onBoardChange: (id: string) => void
  onPieceSetChange: (id: string) => void
  onRoomChange: (id: string) => void
  onMutedChange: (muted: boolean) => void
  onVolumeChange: (volume: number) => void
  onStrengthChange: (level: StrengthLevel) => void
  onColorChange: (color: Color) => void
  onFenChange: (fen: string) => void
  onFenCommit: () => void
  onDumpView: () => void
  onShowBestMoveChange: (show: boolean) => void
  onShowFpsChange: (show: boolean) => void
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
  pieceSetId,
  roomId,
  muted,
  volume,
  strength,
  playerColor,
  fen,
  showBestMove,
  showFps,
  onBoardChange,
  onPieceSetChange,
  onRoomChange,
  onMutedChange,
  onVolumeChange,
  onStrengthChange,
  onColorChange,
  onFenChange,
  onFenCommit,
  onDumpView,
  onShowBestMoveChange,
  onShowFpsChange,
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
        <header className="settings-header">
          <h2>Settings</h2>
          <PixelButton ghost onClick={onClose}>
            Close
          </PixelButton>
        </header>

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
          <div className="btn-row">
            <PixelButton
              ghost={playerColor !== 'white'}
              onClick={() => onColorChange('white')}
            >
              Play White
            </PixelButton>
            <PixelButton
              ghost={playerColor !== 'black'}
              onClick={() => onColorChange('black')}
            >
              Play Black
            </PixelButton>
          </div>
          <div className="settings-row" style={{ marginTop: '0.85rem' }}>
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
            <span id="settings-mute-label">Mute</span>
            <AnimatedSwitch
              checked={muted}
              aria-labelledby="settings-mute-label"
              onCheckedChange={(next) => {
                setMuted(next)
                onMutedChange(next)
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
