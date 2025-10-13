# Vehicles Domain Overview

The Vehicles feature tracks household cars, vans, and bikes alongside their maintenance paperwork so families can keep upcoming MOT, service, and insurance obligations in one place without touching the legacy JSON stores. It sits beside Bills and Pets but remains siloed: the backend exposes full vehicle records via SQLite, IPC lifts those rows into the UI, and the current front end renders a read-only list with a drill-in pane.

## Current state

- **Schema** – The live SQLite schema created by `migrations/0001_baseline.sql` and mirrored in `src-tauri/schema.sql` already carries the accepted Vehicles attribute model (make, model, trim, regulatory dates, finance data, attachment folders, etc.). Older generated snapshots such as `/schema.sql` still reflect the slim pre-migration table, which is why capability probes like `db_has_vehicle_columns` check for specific columns at runtime before enabling UI affordances. The maintenance table is present with vault columns but unused by the UI yet.
- **IPC** – CRUD commands (`vehicles_list/get/create/update/delete/restore`) are wired through `src-tauri/src/commands.rs`, sharing the generic attachment guards and returning the full Rust `Vehicle` struct defined in `src-tauri/src/lib.rs`. TypeScript contracts in `src/lib/ipc/contracts/index.ts` validate registration or VIN and surface every column to the renderer. Maintenance endpoints exist but only mirror the raw table (no joins).
- **UI** – `src/VehiclesView.ts` renders a synchronous list per household and opens `VehicleDetail.ts` for read-only details. There is no creation or editing flow; toast errors from `showError` bubble straight into the shared notification system, and the empty state is provided by `ui/EmptyState` when the list is blank.

## Scope boundaries

Vehicles manages on-disk records for household-owned transport, their regulatory reminders, and supporting maintenance attachments. It does not own billing, insurance policy ingestion, pets, calendar reminders, or dashboard cards—each of those remains under their respective domains. Vehicles also does not currently drive diagnostics masking, export of core vehicle rows, or any automation that updates Bills or Calendar entries.

## Documentation index

- [Architecture](./architecture.md)
- [Database](./database.md)
- [IPC](./ipc.md)
- [UI](./ui.md)
- [Attachments](./attachments.md)
- [Diagnostics](./diagnostics.md)
- [Delivery plan](./plan/overview.md)
