# Arklowdun — Home Management App

Arklowdun is a desktop app for home management, centered around a filestore and a calendar.

Current state: basic app shell with two tabs (Files, Calendar). The Files view uses Tauri's dialog and filesystem plugins to browse and manage the local file system, while the Calendar stores events on disk. Functionality will be implemented iteratively.

## Roadmap (initial)

- Files: choose a base folder and list files; create folders/files; quick search; favorite locations.
- Calendar: month/week/day views; reminders and recurring events; import/export `.ics`.
- Extras: links between files and events; household members and roles; backups.

## Dev

- `npm run dev` — run Vite dev server (Tauri will attach).
- `npm run tauri` — run Tauri CLI (build/dev/bundle).

Recommended IDE: VS Code with Tauri and rust-analyzer extensions.
