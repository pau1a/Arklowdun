# Database Baseline (0001)

The repository now ships a single canonical migration, `0001_baseline.sql`. It
creates every table required by the desktop application and seeds deterministic
reference data so that Manage renders without additional setup. Future schema
changes must be additive migrations that build on this baseline.

## Core tables

The full schema lives in `schema.sql`. Key domain tables:

- **household** — identity, timezone, default flag, and soft-delete columns.
  Exactly one row must have `is_default = 1`; triggers prevent deleting or
  soft-deleting the default household. Every domain table references
  `household(id)` with cascading foreign keys.
- **categories** — per-household catalogue with unique `(slug, position)` pairs,
  timestamp columns without sentinel defaults, and deterministic seed IDs using
  the `cat_<slug>` convention.
- **events** — timezone-aware start/end columns (`*_at_utc`), optional
  recurrence fields (`rrule`, `exdates`), and soft-deletion via `deleted_at`.
- **notes** — persists text, colour, board coordinates (`x`, `y`), stacking
  order (`z`), and scheduling fields (`deadline`, `deadline_tz`).
- **files_index** + **files_index_meta** — canonical structure for indexed
  search, keyed by household and backed by foreign keys.

Legacy tables (bills, vehicles, inventory, etc.) are preserved exactly as the
application expects. Refer to `schema.sql` for the definitive column and index
list, including the `notes_deadline_idx` helper for upcoming-note queries.

## Seeds

`0001_baseline.sql` inserts deterministic bootstrap data:

- Household `default` named “Default Household”.
- Manage categories seeded in priority order: Primary, Secondary, Tasks,
  Bills, Insurance, Property, Vehicles, Pets, Family, Inventory, Budget,
  Shopping. IDs use the `cat_<slug>` convention and timestamps are fixed to
  `1672531200000` (2023‑01‑01 UTC) for reproducibility.

All timestamp columns store **milliseconds since the Unix epoch**. Seed rows
use deterministic values to keep fixture diffs stable.

## Household invariants

- `household.is_default` marks the sole default household. Migrations repair
  legacy databases by selecting the earliest active household when none are
  marked default and clearing duplicate defaults.
- SQLite triggers enforce the invariant: marking one row as default clears all
  others, unsetting the final default aborts, and deleting or soft-deleting the
  default raises `default_household_undeletable`.
- `ensure_household_invariants` runs at startup to repair pre-trigger
  inconsistencies and clear soft-deleted defaults.
- Repairs are logged at INFO (`promote_default`, `trim_defaults`,
  `clear_soft_deleted_default`), and CI runs `npm run smoke:household` to
  enforce the invariant on every build.

## Active household selection

- The backend persists a per-install "active" household id using the Tauri
  store plugin. Startup validates the stored id and falls back to the default
  household if it is missing, deleted, or invalid.
- When a new active id is chosen the backend re-uses the same validation guard
  (`assert_household_active`) and emits a `household:changed` event so the UI
  can invalidate caches.

## Household CRUD

- Backend IPC exposes create, update, delete, and restore commands for
  households. Soft-deleting an active non-default household immediately
  switches the active selection back to the default row and emits a
  `household:changed` event.
- The default household remains undeletable and attempts are mapped to the
  stable error code `DEFAULT_UNDELETABLE`.

## Schema fingerprint

Run the verification helper to refresh fingerprints after intentional schema
changes:

```
$ scripts/verify_schema.sh --db /tmp/baseline.sqlite --schema schema.sql --update
```

The resulting hash must match the value committed alongside this document and
the mirrored `src-tauri/schema.sql`. Update the hash whenever the schema shape
changes. The current canonical hash is:

```
0f6a6099d80e00868664961524e10d399e6367b25fec131c935ec2e96a60ef4b
```
