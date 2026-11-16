# Typing Master

Offline-first typing practice and test platform (English + Hindi).

## Layout

| Path | What it is |
|---|---|
| `packages/typing-engine` | Pure logic: scoring, sessions, keyboard layouts, passages. Shared by every app and the future server. |
| `packages/ui` | React UI (practice flow, live test, results). Rendered by both apps. |
| `apps/web` | Vite web app. |
| `apps/desktop` | Electron desktop app (renders the same UI). |

## Commands (run from the repo root)

```
pnpm install
pnpm dev:web         # web app at http://localhost:5173
pnpm dev:desktop     # Electron window with hot reload
pnpm test            # engine unit tests
pnpm typecheck
pnpm build:web
pnpm build:desktop   # Windows installer -> apps/desktop/release
```

If Electron's binary is missing after install (no `dist/electron.exe`), run
`node install.js` inside `apps/desktop/node_modules/electron`.
