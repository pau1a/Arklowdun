# Database Baseline (0001)

The repository now ships a single canonical migration, `0001_baseline.sql`. It
creates every table required by the desktop application and seeds deterministic
reference data so that Manage renders without additional setup. Future schema
changes must be additive migrations that build on this baseline.

## Core tables

The full schema lives in `schema.sql`. Key domain tables:

- **household** — identity, timezone, and soft-delete columns. Every domain
  table references `household(id)` with cascading foreign keys.
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
6c2c64bf0ed5dbf7f1f0636ef5bddba9a8a86e8996b3fe8f5492d0b0dfee6e77
```
