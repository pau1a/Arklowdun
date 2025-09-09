# Architecture Overview

## Purpose
Arklowdun is a desktop app for home management. This document records the major architecture decisions so newcomers understand the system and future work stays aligned.

## Runtime Architecture
- **Frontend**: Vite + TypeScript UI. Uses Tauri APIs for dialogs, notifications and IPC. UI components surface errors via `showError()`.
- **Backend**: Rust commands exposed to the frontend. Uses `sqlx` for database access, `uuid` for IDs and `chrono` for time handling.
- **Persistence**: SQLite database for structured data plus a notes JSON file as a v1 fallback. Attachments live on disk and are addressed by `(root_key, relative_path)`.
- **IPC**: Frontend communicates with backend through Tauri commands.

## Module Boundaries
- `src/storage.ts` manages root keys and path rules.
- `src/services/*` call into Tauri commands.
- `src/views/*` render UI only and never touch the filesystem directly.
- `src/fs/*` and `src/files/*` are the only modules allowed to import `@tauri-apps/plugin-fs`.
- UI modules import filesystem helpers via `src/files/fs.ts`.

## Storage
- SQLite schema uses UUIDv7 primary keys and millisecond timestamps.
- Foreign keys include `ON UPDATE`/`ON DELETE` rules.
- Notes fall back to JSON files in the first release.
- File attachments are stored by `(root_key, relative_path)` pairs.

## Logging & Env
- Backend uses `tracing` to emit JSON logs. Defaults: `arklowdun=info`, `sqlx=warn`.
- Frontend surfaces issues through `showError()`.
- No telemetry or analytics are collected.

## Feature Flags
In scope:
- Image and PDF previews
- Single reminders
- About pane
- Quick Search MVP (LIKE queries, limit 100, basic ranking). Planned upgrade: FTS5 triggers.

Deferred:
- Recurrence
- Omnibox search
- Canvas notes
- Household switching

## Security Posture
- Database content is unencrypted.
- No telemetry or passphrase protection.
- Users should be aware that local files are accessible to anyone with filesystem access.

## Platform & Packaging
- Target platform is macOS with DMG packaging first.

## Testing
- All tests run locally: Node unit tests and Cargo tests for Rust code. No CI or external services.

## Roadmap Pointers
Next areas of exploration: search features, cross-linking between entities and deeper recurrence support.
