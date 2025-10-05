# Integrity Rules for Migrations

This document captures conventions for enforcing data integrity in our SQLite schema. Apply these constraints whenever tables or columns are introduced in a migration.

## Household Integrity

Household data is protected by a combination of SQL triggers, SQLite foreign keys, and runtime orchestration in the cascade/repair helpers. Keep the following guarantees in mind when touching the household domain or any table that participates in cascading deletion.

### Default household record

- A permanent household row with the string identifier `"default"` is created during boot and flagged with `is_default = 1`. Exactly **one** default row must exist at all times; migrations that backfill legacy data repair or create the default as needed.
- The triggers defined in `migrations/0004_households_invariants.sql` and the consolidated copy in `schema.sql` abort both hard deletes and soft deletes of the default row (`default_household_undeletable`). IPC commands map these failures to the `DEFAULT_UNDELETABLE` error code so the renderer can keep the Delete control disabled and explain why the action is blocked.

### Cascade deletion pipeline

- `household_delete` and `household_resume_delete` tear down a household in phases. Each phase removes a table from `CASCADE_PHASES`, ensuring that note links, notes, events, files metadata, financial records, and remaining domain tables are emptied before the household row itself is removed.
- Progress is reported through the `household_delete_progress` IPC event. Each payload includes the phase name, deleted/total counters, and a status flag of `running`, `paused`, or `completed`. UI progress bars translate this into the cascade HUD while backend logs capture the same events for support review.
- When a cascade pauses (timeout, app exit, crash) the checkpoint tables (`cascade_checkpoints`, `cascade_vacuum_queue`) persist the phase and counts. A later resume continues from the saved phase and emits progress again until completion.

### Database health and write suspension

- The cascade subsystem feeds into the DB health cache. Any unfinished cascade surfaces in health reports as `DB_UNHEALTHY_WRITE_BLOCKED` and the IPC guard rejects new write commands until a repair clears the checkpoint list. The UI presents a red banner and disables destructive actions while this state is active.
- Health checks also propagate foreign-key and WAL corruption failures detected by `db::health::run_health_checks`. These likewise raise `DB_UNHEALTHY_WRITE_BLOCKED` and require operator intervention before writes can continue.

### Repair and re-check

- The `household_repair` command is exposed through Settings → “Run Repair / Re-check” and the diagnostics CLI. It runs `PRAGMA foreign_key_check`, refreshes the cascade health cache, and resumes any pending cascade for the targeted household with a two-second slice budget. Repair succeeds when the cascade completes, the checkpoint row disappears, and the health cache returns to OK. Expect small households to finish in under a second and heavily populated ones to require several passes of the two-second window.
- Successful repairs emit `household_delete_progress` updates and a final `household_delete_resume` log entry that records the total rows deleted, whether an active household fallback occurred, and if a manual VACUUM is recommended.

### Manual VACUUM guidance

- When a cascade finishes with `vacuum_recommended = true`, the UI enables a “Reclaim space” button that calls `household_vacuum_execute`. Trigger this once the cascade and any repair passes are done; the handler removes the row from `cascade_vacuum_queue`, executes `VACUUM`, and clears the health banner. Avoid running VACUUM while a cascade is paused or mid-flight—it blocks write traffic and can extend the unhealthy window.

### Error codes

| Error code | Meaning |
| --- | --- |
| `DEFAULT_UNDELETABLE` | Attempted hard/soft delete of the `"default"` household. |
| `HOUSEHOLD_NOT_FOUND` | Target household id does not exist or has already been purged. |
| `HOUSEHOLD_DELETED` | Target household is soft-deleted and must be restored before updates. |
| `DB_UNHEALTHY_WRITE_BLOCKED` | Database health checks detected a cascade in progress or corruption; write commands are suspended until repair succeeds. |

### Developer map

- SQL triggers: `migrations/0004_households_invariants.sql`, consolidated into `schema.sql` for install-time verification.
- IPC commands: `household_delete`, `household_resume_delete`, `household_repair`, and `household_vacuum_execute` in `src-tauri/src/lib.rs`.
- Diagnostics: cascade checkpoint helpers and progress observers in `src-tauri/src/household.rs` plus health-cache synchronisation in `src-tauri/src/lib.rs`.
- Logs: look for `household_delete_progress`, `household_delete_resume`, `household_repair_failed`, and the DB health summaries emitted by `log_db_health` when unhealthy states are detected.

## UNIQUE

Use `UNIQUE` constraints (or unique indexes) to prevent duplicate natural keys. Favor partial unique indexes that ignore soft-deleted rows.

```sql
-- Example: each file path is unique per household
CREATE UNIQUE INDEX IF NOT EXISTS bills_household_file_idx
  ON bills(household_id, root_key, relative_path)
  WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
```

Apply similar indexes for other tables storing `root_key`/`relative_path` pairs.

## CHECK

`CHECK` constraints ensure values stay within expected bounds or enumerations.

```sql
ALTER TABLE bills
  ADD CONSTRAINT bills_amount_non_negative CHECK (amount >= 0);

ALTER TABLE pets
  ADD CONSTRAINT pets_type_check CHECK (type IN ('dog','cat','fish'));
```

Use these for non-negative amounts, bounded dates, or limited sets of strings.

## Foreign Keys

All foreign keys must declare explicit ON DELETE and ON UPDATE actions. The default is ON DELETE CASCADE ON UPDATE CASCADE unless a migration comment documents a different choice.

## ON DELETE CASCADE

Use `ON DELETE CASCADE` on foreign keys where child rows should disappear automatically when the parent is removed.

```sql
-- Cascade when the parent household or vehicle is deleted
household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
vehicle_id   TEXT NOT NULL REFERENCES vehicles(id)   ON DELETE CASCADE
```

This prevents orphaned rows and keeps cleanup simple.

## Migration

The first migration to apply these rules will be:

```
migrations/0001_baseline.sql
```

Future schema changes should conform to the guidance above and preserve the
baseline guarantees when altering or extending tables.

## Household Scoping

All data access must require a `householdId` and include a `household_id`
filter in SQL. Use `requireHousehold()` at the entry to every repository
helper to fail fast when the id is missing.

```ts
import { listActive, firstActive } from "../src/db/repo";

const bills = await listActive("bills", householdId);
const firstBill = await firstActive("bills", householdId);
```

```rust
use crate::repo;

if let Some(row) = repo::first_active(&pool, "bills", &household_id, None).await? {
    let id: String = row.try_get("id")?;
    // ...
}
```

To obtain a `householdId`, call the `household_get_active` command or
surface a selection flow so the user can choose a household explicitly.

## Household CRUD Guards

- The `household_delete` IPC command soft-deletes rows by setting
  `deleted_at`. If the target row is the current active household, the backend
  immediately switches the active selection back to the default household,
  persists the new selection, and emits `household:changed`.
- Attempts to activate a soft-deleted household are rejected with
  `HOUSEHOLD_DELETED`. When the user targets the already-active household the
  IPC layer short-circuits with `HOUSEHOLD_ALREADY_ACTIVE`.
- SQLite triggers ensure the default household cannot be deleted or
  soft-deleted. The IPC layer maps attempts to stable error codes so the UI can
  present consistent messages.
- Renderer controls keep the default household delete action disabled and the
  backend clears any cascade checkpoints before returning `DEFAULT_UNDELETABLE`
  so health checks remain green.
- Household rows include an optional `color` column (`TEXT NULL`). The backend
  normalises `#RRGGBB` values and rejects invalid input with
  `INVALID_COLOR` so renderer validation bugs cannot corrupt persisted data.

| Scenario | Error code |
| --- | --- |
| Delete default household | `DEFAULT_UNDELETABLE` |
| Operate on a missing household id | `HOUSEHOLD_NOT_FOUND` |
| Operate on a soft-deleted household (update/set active) | `HOUSEHOLD_DELETED` |
| Attempt to set already-active household | `HOUSEHOLD_ALREADY_ACTIVE` |
| Provide an invalid colour swatch payload | `INVALID_COLOR` |

The settings UI mirrors these rules (see `docs/settings-ui.md`). Error codes are
surfaced with friendly copy and the frontend immediately falls back to the
default household when the backend returns a `fallbackId` during delete.

## Notes & Shopping Soft Delete

Notes and shopping items must use soft deletion. Rows are never removed;
instead `deleted_at` is set to the current timestamp. Queries and UI must
exclude rows where `deleted_at` is not `NULL`. The `shopping_live` view
exposes only active rows for shopping items; note queries should filter on
`deleted_at IS NULL` directly. Use the repository helpers `set_deleted_at`,
`clear_deleted_at`, and `renumber_positions` to handle delete and restore
flows while keeping positions dense.
