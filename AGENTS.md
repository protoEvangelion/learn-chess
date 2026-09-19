# Agent notes — chess-3d

## UI components (Cult UI + shadcn)

Prefer **Cult UI** / **shadcn** for new UI chrome. Discover via the **shadcn MCP** (`.cursor/mcp.json`) or CLI:

```bash
npx shadcn@latest search @cult-ui --query "<need>"
npx shadcn@latest search @shadcn --query "<need>"
npx shadcn@latest add <name>
npx shadcn@latest add @cult-ui/<name>
```

Registry config: `components.json` (`@cult-ui` + default `@shadcn`).

### Stack

- **Vite + React** with **Tailwind v4** (`@tailwindcss/vite`) and **shadcn** (radix-nova).
- Tailwind entry + `@theme` tokens live in `src/App.css` (not a separate `index.css` import) so utilities resolve.
- App chrome uses `--sw-*`; shadcn `--accent` in `.dark` is tuned for visible hover on dark panels.
- Tailwind v4 no longer sets `cursor: pointer` on buttons in Preflight; we restore it in `@layer base` (official upgrade-guide pattern). Select items use Radix `data-highlighted` (not `:hover`) for list highlight.

### Workflow for agents

1. Search Cult / shadcn (MCP or CLI) for the need.
2. Prefer `npx shadcn@latest add …` when Tailwind works for that surface.
3. **If no suitable component exists (or it’s Pro-only / blocked): say so explicitly** — do not invent a fake wrapper.
4. Cult UI **Pro** needs `CULT_UI_API_KEY` on the shadcn MCP env (https://pro.cult-ui.com/mcp).

### Opening-drill line picker

- Uses **`@shadcn/select`** in `DrillDialog` (`src/components/ui/select.tsx`).
- Cult **Animated Select** is Pro-only — call that out if upgrading later.

### Opening coach cards (Turso)

- Lazy per-line briefing: `POST /api/opening-card` with `{ line: { id, name, eco, summary, moves[{san}] } }`.
- Stored in Turso (`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`) or local `.data/opening-cards.db`.
- Prefetched when a drill line starts; coach `/api/explain` + `/api/coach-chat` inject the **cached** card only (never the whole pack).

### Enabling MCP in Cursor

1. `.cursor/mcp.json` → `shadcn`
2. Cursor Settings → MCP → enable **shadcn**
3. Optional Pro: set `CULT_UI_API_KEY` in the environment
