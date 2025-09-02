# Storage Conventions

All persistent records use [UUIDv7](https://uuid6.github.io/uuid7/) identifiers.
Primary and foreign key columns in SQLite migrations are declared as `TEXT` and
contain canonical UUID strings.

Timestamps are stored as milliseconds since the Unix epoch in `INTEGER` fields.
When generating times, use helper functions to ensure consistency.

On load, legacy ISO 8601 timestamp strings are coerced to milliseconds and
written back to disk. This keeps existing files working while moving them to
the integer format.

```ts
import { toMs } from "../src/db/normalize";

const ms = toMs("2023-07-16T12:34:56Z"); // => 1689510896000
```

## Soft Deletion

Domain tables include a nullable `deleted_at INTEGER` column. A row is
considered active when this column is `NULL`. Queries should filter on
`deleted_at IS NULL` by default and repository helpers are provided to set or
clear the timestamp.

In TypeScript models this field appears as an optional `deleted_at?: number` and
in Rust as `Option<i64>` with serde aliasing and skipping serialization when
`None`:

```ts
interface Example {
  deleted_at?: number;
}
```

```rust
#[serde(alias = "deletedAt", default, skip_serializing_if = "Option::is_none")]
deleted_at: Option<i64>
```

Clients SHOULD omit `deleted_at` when not set; servers and SDKs omit it when
`NULL`/`None`.

### Operations

Soft deletion and restoration are exposed via Tauri commands:
`delete_household_cmd` and `restore_household_cmd`. Both update `updated_at`
and toggle `deleted_at`. Deleting the current default household returns the
replacement id so callers can refresh local state.

### Listing Active Rows

Repository helpers automatically filter out soft-deleted rows and apply standard ordering.

```ts
import { listActive, firstActive } from "../src/db/repo";

// Household-scoped listing (recommended)
const bills = await listActive("bills", { householdId });

// Fetch the first active row
const firstBill = await firstActive("bills", { householdId });
```

```rust
use crate::repo;

// Household-scoped and first row
if let Some(row) = repo::first_active(&pool, "bills", Some(&household_id), None).await? {
    let id: String = row.try_get("id")?;
    // ...
}
```

## Ordering

Some domain tables maintain a user-defined ordering using a `position INTEGER`
column that defaults to `0`. Rows are unique per household and position via a
partial `(household_id, position)` index that ignores soft-deleted rows.
Repository helpers provide a `renumber_positions` routine which compacts
positions starting from zero, and reordering helpers run inside database
transactions to ensure consistency. To avoid unique-index conflicts during
reorders, active rows are first shifted out of the way before applying new
positions. Soft-delete helpers also invoke this compaction to keep active rows
dense from zero. Queries that return ordered data should sort by `position, created_at`.

## Generating IDs

```ts
import { newUuidV7 } from "../src/db/id";
import { nowMs, toDate } from "../src/db/time";

const id = newUuidV7();
const created = nowMs();
const when = toDate(created);
```

```rust
use crate::id::new_uuid_v7;
use crate::time::{now_ms, to_date};

let id = new_uuid_v7();
let created = now_ms();
let when = to_date(created);
```

## Example

```sql
CREATE TABLE example (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES example(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Existing numeric identifiers are converted to new UUIDv7 values on import.

## File Paths

File references are stored as a `(root_key, relative_path)` pair. The
`root_key` selects a platform directory using the Tauri path API and the
`relative_path` is joined to it to produce an absolute path.

Current root mappings:

| root_key                                                                        | Base directory                         |
| -------------------------------------------------------------------------------- | -------------------------------------- |
| `appData`, `appConfig`, `appLocalData`, `appCache`                               | app-scoped dirs                        |
| `home`, `desktop`, `document`, `download`, `picture`, `audio`, `video`, `public` | user dirs                              |
| `cache`, `config`, `data`, `localData`                                           | user-scoped XDG / platform equivalents |
| `resource`, `runtime`, `template`, `temp`, `font`                                | platform-specific                      |

Root availability varies by operating system—some keys like `font`, `template`, or `runtime` may not resolve. Callers should handle `resolvePath` failure gracefully.

When both `root_key` and `relative_path` are non-`NULL` (and the row is not
soft-deleted), the pair must be unique per household. Relative paths are
normalized to forward slashes, leading slashes removed, Windows drive prefixes
stripped, and `.`/`..` segments collapsed to prevent path traversal. The SQL
backfill only normalizes slashes and trims a leading `/`, so legacy rows may
retain `.` or `..` segments until rewritten by the application.

## JSON Import Tool

The `src/tools/import-json.ts` script loads a legacy JSON export and writes the
records into the SQLite database. Numeric identifiers are replaced with new
UUIDv7 values, timestamp fields are coerced to milliseconds, and list tables
receive sequential `position` values starting at zero. All inserts run inside a
transaction and commit only if the entire import succeeds. A sentinel row is
written to the `settings` table to prevent accidental re-runs.

### Usage

```bash
node --loader ts-node/esm src/tools/import-json.ts /path/to/data.json --db "/absolute/path/to/app.sqlite"
# Dry run without writing to the database
node --loader ts-node/esm src/tools/import-json.ts /path/to/data.json --db "/absolute/path/to/app.sqlite" --dry-run
# Force re-run even if a sentinel exists
node --loader ts-node/esm src/tools/import-json.ts /path/to/data.json --db "/absolute/path/to/app.sqlite" --force
```
