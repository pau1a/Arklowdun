# Integrity Rules for Migrations

This document captures conventions for enforcing data integrity in our SQLite schema. Apply these constraints whenever tables or columns are introduced in a migration.

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
