# Vehicles Architecture

### 1. Stack overview

```
SQLite (vehicles, vehicle_maintenance)
        ↓  (sqlx models & helpers)
Rust commands (src-tauri/src/commands.rs, Vehicle struct in src-tauri/src/lib.rs)
        ↓  (tauri IPC contracts validated in src/lib/ipc/contracts/index.ts)
TypeScript repo (src/db/vehiclesRepo.ts)
        ↓  (legacy DOM renderer)
VehiclesView & VehicleDetail (src/VehiclesView.ts, src/VehicleDetail.ts)
```

The Vehicles stack is intentionally thin: SQLx queries in `list_vehicles` and `get_vehicle` select every column from the `vehicles` table, coercing legacy installs that lack `trim` into a NULL alias. The results are deserialised into the `Vehicle` struct exported to the TypeScript bindings. All mutations (`vehicles_create`, `vehicles_update`, `vehicles_delete`, `vehicles_restore`) funnel through the generic attachment-aware helpers in `src-tauri/src/commands.rs`, so Vehicles benefits from the shared transaction scopes, automatic timestamps, and audit logging that other vault-backed tables use.

### 2. Vehicle ↔ maintenance relationship

`vehicle_maintenance` rows reference their parent via `vehicle_id` with `ON DELETE CASCADE`, and the Rust integration test `household_delete_cascades_vehicle_records` proves that deleting a household removes both levels. No IPC surface currently joins maintenance into the main vehicle payload: the maintenance CRUD endpoints reuse the generic repo helpers without extra SELECT clauses, and the UI never calls them. Attachments associated with maintenance rows therefore live in the vault independently and only surface through diagnostics and export tooling.

### 3. Transactions, soft deletes, and attachment guards

- **Transactions** – `create_command` and `update_command` open SQL statements through the shared `create`/`update` helpers, ensuring insert/update work happens atomically with attachment guard evaluation. While the helpers do not currently wrap the operations in an explicit `BEGIN`, the command boundary ensures each call executes as a single statement against SQLite.
- **Soft deletes** – `delete_command` calls `repo::set_deleted_at`, marking the record’s `deleted_at` column and leaving it eligible for restoration via `restore_command`. Vehicles has no hard-delete path; maintenance rows inherit the same behaviour.
- **Attachment guards** – `AttachmentMutationGuard` enforces vault invariants for tables listed in `vault_migration::ATTACHMENT_TABLES`, which includes `vehicle_maintenance`. On create/update the guard normalises the relative path, rejects mismatched households, forces `root_key` to `NULL`, and records the category (`vehicle_maintenance`). On delete the guard removes the on-disk file when present before the soft delete runs.

### 4. Key modules

| Layer                | Files |
| -------------------- | ----- |
| Schema definitions   | `migrations/0001_baseline.sql`, `src-tauri/schema.sql` |
| Rust IPC surface     | `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs` |
| TypeScript contracts | `src/lib/ipc/contracts/index.ts`, `src/bindings/Vehicle.ts` |
| Repo + UI            | `src/db/vehiclesRepo.ts`, `src/VehiclesView.ts`, `src/VehicleDetail.ts`, `src/ui/views/vehiclesView.ts` |
| Tests                | `src-tauri/tests/vehicles_schema.rs` |
