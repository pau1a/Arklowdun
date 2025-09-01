# Storage Conventions

All persistent records use [UUIDv7](https://uuid6.github.io/uuid7/) identifiers.
Primary and foreign key columns in SQLite migrations are declared as `TEXT` and
contain canonical UUID strings.

## Generating IDs

```ts
import { newUuidV7 } from "../src/db/id";

const id = newUuidV7();
```

```rust
use crate::id::new_uuid_v7;

let id = new_uuid_v7();
```

## Example

```sql
CREATE TABLE example (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES example(id)
);
```

Existing numeric identifiers are converted to new UUIDv7 values on import.
