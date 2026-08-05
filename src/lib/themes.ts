export type Vec3 = [number, number, number]

export type BoardTheme = {
  id: string
  name: string
  credit: string
  license: string
  /** null = procedural tiles + border */
  modelPath: string | null
  scale: Vec3
  position: Vec3
  rotation: Vec3
  /** Show procedural Border + coordinates */
  showProceduralBorder: boolean
  /** solid tiles vs transparent hit targets over a mesh board */
  tileMode: 'solid' | 'hit'
  previewColor: string
  preview: string
}

export type PieceColorPaths = {
  white: string
  black: string
}

export type PieceSetTheme = {
  id: string
  name: string
  credit: string
  license: string
  /** classic = root public gltfs; glb = geometry+shared material; textured = keep materials */
  kind: 'classic' | 'glb' | 'textured'
  paths?: {
    pawn: string | PieceColorPaths
    rook: string | PieceColorPaths
    knight: string | PieceColorPaths
    bishop: string | PieceColorPaths
    queen: string | PieceColorPaths
    king: string | PieceColorPaths
  }
  /** Extra yaw (radians) per piece type — number for both colors, or per-color */
  yawByType?: Partial<
    Record<
      'pawn' | 'rook' | 'knight' | 'bishop' | 'queen' | 'king',
      number | { white: number; black: number }
    >
  >
  /** Applied on MeshWrapper outer scale (classic uses 0.15) */
  wrapperScale: number
  /** Inner mesh scale (classic uses 0.03); ignored for textured */
  meshScale: number
  previewColor: string
  preview: string
}

export type RoomTheme = {
  id: string
  name: string
  credit: string
  license: string
  /** null = flat background only */
  modelPath: string | null
  scale: Vec3
  position: Vec3
  rotation: Vec3
  background: string
  hdr: string
  previewColor: string
  preview: string
  /** Nudge board + pieces (e.g. lower onto a table) */
  boardOffset?: Vec3
  /** Optional camera when this room is active */
  cameraPosition?: Vec3
  cameraFov?: number
  /** Orbit distance clamps for indoor rooms */
  minDistance?: number
  maxDistance?: number
  /** Orbit tilt clamps (radians from +Y); defaults ~PI/6 .. PI/2.15 */
  minPolarAngle?: number
  maxPolarAngle?: number
}

export const BOARD_THEMES: BoardTheme[] = [
  {
    id: 'procedural',
    name: 'Classic',
    credit: 'joshwrn / procedural tiles',
    license: 'See upstream 3d-chess',
    modelPath: null,
    scale: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    showProceduralBorder: true,
    tileMode: 'solid',
    previewColor: '#8a8a8a',
    preview: '/assets/previews/boards/classic.svg',
  },
  {
    id: 'wood',
    name: 'Walnut',
    credit: 'Curated procedural wood board (project-generated GLB)',
    license: 'CC0',
    modelPath: '/assets/boards/wood/model.glb',
    scale: [1, 1, 1],
    // World-space: playable top at y=0 (matches piece resting height).
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    showProceduralBorder: false,
    tileMode: 'hit',
    previewColor: '#6b4423',
    preview: '/assets/previews/boards/walnut.svg',
  },
  {
    id: 'retropc',
    name: 'Retro PC',
    credit:
      'https://sketchfab.com/3d-models/retropc-chess-31e657b251b546e69e6ae312fc0bf66a',
    license: 'See Sketchfab listing / CC-BY if applicable',
    modelPath: '/assets/boards/retropc/model.glb',
    scale: [1, 1, 1],
    position: [0, 0, 0],
    // Sketchfab board had files on the side — yaw so a–h sit on the near/far edges
    rotation: [0, Math.PI / 2, 0],
    showProceduralBorder: false,
    tileMode: 'hit',
    previewColor: '#2a4a3a',
    preview: '/assets/previews/boards/retropc.svg',
  },
  {
    id: 'glass',
    name: 'Glass',
    credit:
      'Al (@lightningocelot) — https://sketchfab.com/3d-models/chess-board-a0d61768bc504082901728ec9603fa0d',
    license: 'CC-BY',
    modelPath: '/assets/boards/glass/model.glb?v=3',
    scale: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    showProceduralBorder: false,
    tileMode: 'hit',
    previewColor: '#7aa0b8',
    preview: '/assets/previews/boards/glass.svg',
  },
  {
    id: 'chessset',
    name: 'Low Poly',
    credit:
      'https://sketchfab.com/3d-models/chess-set-89509e3c894c40a68542bdc586b38c9c',
    license: 'See Sketchfab listing / CC-BY if applicable',
    modelPath: '/assets/boards/chessset/model.glb?v=6',
    scale: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    showProceduralBorder: false,
    tileMode: 'hit',
    previewColor: '#dcc95c',
    preview: '/assets/previews/boards/chessset.svg',
  },
  {
    id: 'verfassen',
    name: 'Ornate',
    credit:
      'Verfassen — https://sketchfab.com/3d-models/chess-e54c2d04d4f74823b69ba4a794fb4500',
    license: 'CC-BY',
    modelPath: '/assets/boards/verfassen/model.glb',
    scale: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    showProceduralBorder: false,
    tileMode: 'hit',
    previewColor: '#b87333',
    preview: '/assets/previews/boards/verfassen.svg',
  },
]

export const PIECE_SETS: PieceSetTheme[] = [
  {
    id: 'classic',
    name: 'Metal',
    credit: 'joshwrn Sketchfab pieces',
    license: 'See upstream 3d-chess',
    kind: 'classic',
    wrapperScale: 0.15,
    meshScale: 0.03,
    previewColor: '#c0c0c0',
    preview: '/assets/previews/pieces/metal.svg',
  },
  {
    id: 'retropc',
    name: 'Retro PC',
    credit:
      'https://sketchfab.com/3d-models/retropc-chess-31e657b251b546e69e6ae312fc0bf66a',
    license: 'See Sketchfab listing / CC-BY if applicable',
    kind: 'textured',
    paths: {
      pawn: {
        white: '/assets/pieces/retropc/pawn-w.glb',
        black: '/assets/pieces/retropc/pawn-b.glb',
      },
      rook: {
        white: '/assets/pieces/retropc/rook-w.glb',
        black: '/assets/pieces/retropc/rook-b.glb',
      },
      knight: {
        white: '/assets/pieces/retropc/knight-w.glb',
        black: '/assets/pieces/retropc/knight-b.glb',
      },
      bishop: {
        white: '/assets/pieces/retropc/bishop-w.glb',
        black: '/assets/pieces/retropc/bishop-b.glb',
      },
      queen: {
        white: '/assets/pieces/retropc/queen-w.glb',
        black: '/assets/pieces/retropc/queen-b.glb',
      },
      king: {
        white: '/assets/pieces/retropc/king-w.glb',
        black: '/assets/pieces/retropc/king-b.glb',
      },
    },
    // Board was yawed 90° for labels — rotate all pieces toward the opponent
    yawByType: {
      pawn: -Math.PI / 2,
      rook: -Math.PI / 2,
      knight: -Math.PI / 2,
      bishop: -Math.PI / 2,
      queen: -Math.PI / 2,
      king: -Math.PI / 2,
    },
    wrapperScale: 1,
    meshScale: 1,
    previewColor: '#3d6b5c',
    preview: '/assets/previews/pieces/retropc.svg',
  },
  {
    id: 'glass',
    name: 'Glass',
    credit:
      'Al (@lightningocelot) — https://sketchfab.com/3d-models/chess-board-a0d61768bc504082901728ec9603fa0d',
    license: 'CC-BY',
    kind: 'textured',
    paths: {
      pawn: {
        white: '/assets/pieces/glass/pawn-w.glb?v=3',
        black: '/assets/pieces/glass/pawn-b.glb?v=3',
      },
      rook: {
        white: '/assets/pieces/glass/rook-w.glb?v=3',
        black: '/assets/pieces/glass/rook-b.glb?v=3',
      },
      knight: {
        white: '/assets/pieces/glass/knight-w.glb?v=3',
        black: '/assets/pieces/glass/knight-b.glb?v=3',
      },
      bishop: {
        white: '/assets/pieces/glass/bishop-w.glb?v=3',
        black: '/assets/pieces/glass/bishop-b.glb?v=3',
      },
      queen: {
        white: '/assets/pieces/glass/queen-w.glb?v=3',
        black: '/assets/pieces/glass/queen-b.glb?v=3',
      },
      king: {
        white: '/assets/pieces/glass/king-w.glb?v=3',
        black: '/assets/pieces/glass/king-b.glb?v=3',
      },
    },
    wrapperScale: 1,
    meshScale: 1,
    previewColor: '#7aa0b8',
    preview: '/assets/previews/pieces/glass.svg',
  },
  {
    id: 'chessset',
    name: 'Low Poly',
    credit:
      'https://sketchfab.com/3d-models/chess-set-89509e3c894c40a68542bdc586b38c9c',
    license: 'See Sketchfab listing / CC-BY if applicable',
    kind: 'textured',
    paths: {
      pawn: {
        white: '/assets/pieces/chessset/pawn-w.glb?v=3',
        black: '/assets/pieces/chessset/pawn-b.glb?v=3',
      },
      rook: {
        white: '/assets/pieces/chessset/rook-w.glb?v=3',
        black: '/assets/pieces/chessset/rook-b.glb?v=3',
      },
      knight: {
        white: '/assets/pieces/chessset/knight-w.glb?v=3',
        black: '/assets/pieces/chessset/knight-b.glb?v=3',
      },
      bishop: {
        white: '/assets/pieces/chessset/bishop-w.glb?v=3',
        black: '/assets/pieces/chessset/bishop-b.glb?v=3',
      },
      queen: {
        white: '/assets/pieces/chessset/queen-w.glb?v=3',
        black: '/assets/pieces/chessset/queen-b.glb?v=3',
      },
      king: {
        white: '/assets/pieces/chessset/king-w.glb?v=3',
        black: '/assets/pieces/chessset/king-b.glb?v=3',
      },
    },
    wrapperScale: 1,
    meshScale: 1,
    previewColor: '#dcc95c',
    preview: '/assets/previews/pieces/chessset.svg',
  },
  {
    id: 'verfassen',
    name: 'Ornate',
    credit:
      'Verfassen — https://sketchfab.com/3d-models/chess-e54c2d04d4f74823b69ba4a794fb4500',
    license: 'CC-BY',
    kind: 'textured',
    paths: {
      pawn: {
        white: '/assets/pieces/verfassen/pawn-w.glb',
        black: '/assets/pieces/verfassen/pawn-b.glb',
      },
      rook: {
        white: '/assets/pieces/verfassen/rook-w.glb',
        black: '/assets/pieces/verfassen/rook-b.glb',
      },
      knight: {
        white: '/assets/pieces/verfassen/knight-w.glb',
        black: '/assets/pieces/verfassen/knight-b.glb',
      },
      bishop: {
        white: '/assets/pieces/verfassen/bishop-w.glb',
        black: '/assets/pieces/verfassen/bishop-b.glb',
      },
      queen: {
        white: '/assets/pieces/verfassen/queen-w.glb?v=2',
        black: '/assets/pieces/verfassen/queen-b.glb?v=2',
      },
      king: {
        white: '/assets/pieces/verfassen/king-w.glb?v=2',
        black: '/assets/pieces/verfassen/king-b.glb?v=2',
      },
    },
    wrapperScale: 1,
    meshScale: 1,
    previewColor: '#b87333',
    preview: '/assets/previews/pieces/verfassen.svg',
  },
]

export const ROOM_THEMES: RoomTheme[] = [
  {
    id: 'void',
    name: 'Void',
    credit: 'Default gradient void',
    license: 'CC0',
    modelPath: null,
    scale: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    background: '#0b0b0b',
    hdr: '/dawn.hdr',
    previewColor: '#0b0b0b',
    preview: '/assets/previews/rooms/void.svg',
  },
  {
    id: 'dining',
    name: 'Dining',
    credit:
      'https://sketchfab.com/3d-models/modern-dining-room-df3f3c9f6233447eb8b7ee129f3bace5',
    license: 'See Sketchfab listing / CC-BY if applicable',
    modelPath: '/assets/rooms/dining/room-v3.glb',
    // Scale/placement baked in prep-dining-room.mjs (board ~55% of table width)
    scale: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    // Drop board onto tabletop (tweak if still high/low)
    boardOffset: [0, -3.6, 2.5],
    background: '#1a1814',
    hdr: '/dawn.hdr',
    previewColor: '#c4b49a',
    preview: '/assets/previews/rooms/dining.svg',
    cameraPosition: [0.07, 13.552, 12.403],
    cameraFov: 40,
    minDistance: 5,
    maxDistance: 45,
    minPolarAngle: 0.524,
    maxPolarAngle: 1.461,
  },
]

export const BOARD_KEY = 'chess-3d:boardId'
export const PIECE_KEY = 'chess-3d:pieceSetId'
export const ROOM_KEY = 'chess-3d:roomId'
export const MUTE_KEY = 'chess-3d:muted'
export const VOLUME_KEY = 'chess-3d:volume'
export const BEST_MOVE_KEY = 'chess-3d:showBestMove'
export const FPS_KEY = 'chess-3d:showFps'

export function loadBoardId(): string {
  const id = localStorage.getItem(BOARD_KEY)
  return BOARD_THEMES.some((t) => t.id === id) ? (id as string) : 'procedural'
}

export function loadPieceSetId(): string {
  const id = localStorage.getItem(PIECE_KEY)
  return PIECE_SETS.some((t) => t.id === id) ? (id as string) : 'classic'
}

export function loadRoomId(): string {
  const id = localStorage.getItem(ROOM_KEY)
  return ROOM_THEMES.some((t) => t.id === id) ? (id as string) : 'void'
}

export function loadMuted(): boolean {
  return localStorage.getItem(MUTE_KEY) === '1'
}

export function loadVolume(): number {
  const v = Number(localStorage.getItem(VOLUME_KEY) ?? 0.7)
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7
}

export function loadShowBestMove(): boolean {
  return localStorage.getItem(BEST_MOVE_KEY) === '1'
}

export function loadShowFps(): boolean {
  return localStorage.getItem(FPS_KEY) === '1'
}

export function getBoardTheme(id: string): BoardTheme {
  return BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0]
}

export function getPieceSet(id: string): PieceSetTheme {
  return PIECE_SETS.find((t) => t.id === id) ?? PIECE_SETS[0]
}

export function getRoomTheme(id: string): RoomTheme {
  return ROOM_THEMES.find((t) => t.id === id) ?? ROOM_THEMES[0]
}
