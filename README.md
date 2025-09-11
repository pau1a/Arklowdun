# Arklowdun — Home Management App

Arklowdun is a desktop app for home management, centered around a filestore and a calendar.

Current state: basic app shell with three tabs (Files, Calendar, Notes). The Files view uses Tauri's dialog and filesystem plugins to browse and manage the local file system, the Calendar stores events on disk, and the Notes view lets you create draggable colored notes that persist to disk. Functionality will be implemented iteratively.

See the [Arklowdun Master Plan](docs/master-plan.md) for the high-level strategic issues that guide development.

## Roadmap (initial)

- Files: choose a base folder and list files; create folders/files; quick search; favorite locations.
- Calendar: month/week/day views; reminders and recurring events; import/export `.ics`.
- Extras: links between files and events; household members and roles; backups.

## Dev

- `npm run dev` — run Vite dev server (Tauri will attach).
- `npm run tauri` — run Tauri CLI (build/dev/bundle).
- `npm run check-all` — run local guard checks.

Recommended IDE: VS Code with Tauri and rust-analyzer extensions.

## Logging & Verbosity

- Backend (Rust):
  `TAURI_ARKLOWDUN_LOG="arklowdun=debug,sqlx=info" npm run tauri dev`
  (default: `arklowdun=info,sqlx=warn`)
  `TAURI_ARKLOWDUN_LOG="arklowdun=info,sqlx=warn" npm run tauri build` # Example production run with quieter SQLx
- Frontend (TS):
  `VITE_LOG_LEVEL=debug npm run tauri dev`
  (allowed: `debug|info|warn|error`)

## Database integrity

Schema constraint guidelines live in [docs/integrity-rules.md](docs/integrity-rules.md).

## Documentation

- [Architecture Overview](docs/architecture/1-overview.md)
- [Search semantics](docs/search.md)
  - Quick Search is available via the command palette (⌘K/Ctrl+K). Results are case-insensitive and ordered by score, timestamp and a stable ordinal. Queries shorter than two characters are ignored; set `VITE_SEARCH_MINLEN=1` during development to enable single-character searches.

## Shortcuts

- Command palette: ⌘K (macOS) / Ctrl+K (Windows/Linux)

## Crash Recovery

SQLite uses WAL journaling, `synchronous=FULL`, and all writes run inside transactions. On startup the app runs `PRAGMA quick_check;` and will refuse to open if it reports corruption so the user can restore the most recent backup. When the check fails a dialog lets you open the backup folder or quit. If the app crashes during a write, restart and the database will roll back to the last committed state. In rare cases you can remove any `arklowdun.sqlite3-wal` or `arklowdun.sqlite3-shm` files and relaunch to rebuild the database from migrations.
