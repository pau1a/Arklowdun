# Vehicles PR1 — Schema and IPC Baseline Expansion

## Scope
- Extend the baseline schema (`migrations/0001_baseline.sql`, `src-tauri/schema.sql`) with the full Vehicles attribute set, JSON-backed fields, and nullable-safe unique indices for registration and VIN.
- Mirror schema updates in the fixture generator (`fixtures/large/seed.ts`) so local smoke data exercises every column.
- Expose the enlarged column set through Rust (`src-tauri/src/lib.rs`) and TypeScript (`src/lib/ipc/contracts/index.ts`) with validation for VIN length and uppercase registration numbers.
- Introduce Vehicles-focused integration tests (`src-tauri/tests/vehicles_schema.rs`) covering round-trip CRUD, uniqueness errors, foreign-key cascades, and integrity checks.

## Implementation Notes
- New due-date indexing (`idx_vehicles_due_dates`) and uniqueness guards (`uq_vehicles_household_reg`, `uq_vehicles_household_vin`) are part of the first-run schema to avoid follow-up migrations.
- IPC writes now open explicit SQLx transactions via the shared command helpers, ensuring `vehicles_create`/`vehicles_update` commit atomically before returning to the UI.
- Fixture data populates JSON text columns (`additional_driver_ids`, `tags`) with encoded arrays to mimic production exports.
- Zod contracts enforce at least one of `reg`/`vin` and accept epoch millisecond integers for every timestamp field.

## Testing
- `cargo test -p arklowdun vehicles_schema` exercises the new Vehicles integration suite.
- `scripts/migrate.sh fresh` followed by `npm run tauri -- dev` validates that a clean boot presents the expanded schema without manual intervention.
