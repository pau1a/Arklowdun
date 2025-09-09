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
The first migration to apply them will be
`migrations/202509021200_add_integrity_constraints.sql`.

## Documentation

- [Architecture Overview](docs/architecture/1-overview.md)
- Quick Search: available in omnibox at top of views. Limit 100 results, load more supported. Queries shorter than two characters are ignored; set `VITE_SEARCH_MINLEN=1` during development to enable single-character searches.
