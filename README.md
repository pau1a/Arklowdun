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
- `scripts/check_migrations.sh` — verify numbering/pairing (prints OK or first error)
- `scripts/renumber_migrations.sh -n|--apply` — dry-run/apply contiguous renumbering

Recommended IDE: VS Code with Tauri and rust-analyzer extensions.

## Logging & Verbosity

- Backend (Rust):
  `TAURI_ARKLOWDUN_LOG="arklowdun=debug,sqlx=info" npm run tauri dev`
  (default: `arklowdun=info,sqlx=warn`)
  `TAURI_ARKLOWDUN_LOG="arklowdun=info,sqlx=warn" npm run tauri build` # Example production run with quieter SQLx
- Frontend (TS):
  `VITE_LOG_LEVEL=debug npm run tauri dev`
  (allowed: `debug|info|warn|error`)

### Logging & Rotation

- Stdout: JSON logs (RFC3339) controlled by `TAURI_ARKLOWDUN_LOG`.
- File logs: `<appDataDir>/logs/arklowdun.log` (rotates by size, keeps N files).

Env:
  TAURI_ARKLOWDUN_LOG=arklowdun=debug,sqlx=warn
  TAURI_ARKLOWDUN_LOG_MAX_SIZE_BYTES=1048576
  TAURI_ARKLOWDUN_LOG_MAX_FILES=3

Dev tools:
  cargo run --bin log_stress        # flood logs (respects env caps)
  cargo test --test log_file_smoke  # checks file JSON sink
  cargo test --test log_rotation    # rotation across restarts

## Database integrity

Schema constraint guidelines live in [docs/integrity-rules.md](docs/integrity-rules.md).
See [docs/migration-guidelines.md](docs/migration-guidelines.md) for detailed safety and testing practices.

## Migrations

Schema changes are managed through sequential SQL files; see
[docs/migrations-spec.md](docs/migrations-spec.md) for versioning rules and
upgrade paths.

## Migration Recovery

- **Restore from backup**
  - Preferred recovery is restoring the database file or dump from a known-good backup.
  - Backups usually live in the app data directory or an external backup system.

- **Using downs/ups** (development only)
  - `*.down.sql` files exist as development aids.
  - Manual rollback and reapply:
    ```sh
    sqlite3 app.db < migrations/NNNN_label.down.sql
    sqlite3 app.db < migrations/NNNN_label.up.sql
    ```
  - Risky and not intended for production—prefer backups.

- **Reapplying ups after a crash**
  - Failed migrations are wrapped in a transaction; errors roll everything back.
  - On next start, `apply_migrations` retries automatically. Check logs for the failing SQL.

- **Troubleshooting tips**
  - Schema drift (table/column mismatch) → delete temp DB and restore from fixture or backup.
  - Locked database files → close other processes or inspect WAL files.
  - Foreign key violations during migration → verify test fixtures and data consistency.
  - Integrity checks:
    ```sql
    PRAGMA integrity_check;
    PRAGMA foreign_key_check;
    ```
  - See [docs/migrations-spec.md](docs/migrations-spec.md) for context.

## Documentation

- [Architecture Overview](docs/architecture/1-overview.md)
- [Search semantics](docs/search.md)
  - Quick Search is available via the command palette (⌘K/Ctrl+K). Results are case-insensitive and ordered by score, timestamp and a stable ordinal. Queries shorter than two characters are ignored; set `VITE_SEARCH_MINLEN=1` during development to enable single-character searches.

## Shortcuts

- Command palette: ⌘K (macOS) / Ctrl+K (Windows/Linux)
