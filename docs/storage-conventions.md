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

Merry Christmas
