# Learn Chess

Local 3D chess with a Stockfish opponent and an LLM coach that gives progressive tips aligned to the engine’s best move.

![Learn Chess — board, coach tips, and eval](docs/snapshot.png)

## Requirements

- **Node.js** 20+ (npm)
- **[Cursor CLI](https://cursor.com/docs/cli/overview)** (`agent` on your `PATH`) — used by the coach (`Ask coach`)
- A machine that can run WebAssembly (Stockfish in the browser)

## Run

```bash
git clone git@github.com:protoEvangelion/learn-chess.git
cd learn-chess
npm install
npm run dev
```

Open the URL Vite prints (default [http://127.0.0.1:5173](http://127.0.0.1:5173)).

Optional:

```bash
npm run dev -- --host 127.0.0.1 --port 5174
```

### Coach (optional)

`Ask coach` shells out to Cursor CLI in ask mode. Sign in / configure the CLI first so `agent` works in a terminal. Override the model with:

```bash
CURSOR_EXPLAIN_MODEL=gpt-5.6-luna-low-fast npm run dev
```

Each game gets a `gameId` in the URL so the coach resumes the same CLI chat and can follow how the game is progressing.

## Features

- 3D board with move animations and coordinate labels
- Play as White or Black vs Stockfish (strength 1–8)
- Eval bar, material imbalance, check highlight, last-move glow
- Progressive coach tips (nudge → closer look → full move) tied to Stockfish
- Position in the URL (`fen` + `gameId`); **Undo** is browser back

## Credits

- **3D chessboard, pieces, and core board logic** adapted from [joshwrn/3d-chess](https://github.com/joshwrn/3d-chess) by [joshwrn](https://github.com/joshwrn)
- **Stockfish** via the lite WASM build in `public/engines/`
- **chess.js** for FEN helpers and SAN labeling for the coach

## License

See upstream [joshwrn/3d-chess](https://github.com/joshwrn/3d-chess) for original board asset licensing; this project’s app code is provided as-is for learning use.
