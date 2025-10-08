# IPC contracts

## Registered commands
The `gen_domain_cmds!` macro in `src-tauri/src/lib.rs` registers the six Family endpoints:

| Command | Parameters | Return value |
| --- | --- | --- |
| `family_members_list` | `household_id`, optional `order_by`, `limit`, `offset` | `Vec<serde_json::Value>` rows filtered to the active household | 
| `family_members_get` | optional `household_id`, `id` | `Option<serde_json::Value>` for the matching active row |
| `family_members_create` | JSON object (`data`) | Inserted row as a JSON object |
| `family_members_update` | `id`, JSON `data`, optional `household_id` | `()` |
| `family_members_delete` | `household_id`, `id` | `()` |
| `family_members_restore` | `household_id`, `id` | `()` |

Each command is an async Tauri handler that immediately delegates to the shared command helpers without adding logging or tracing statements.【F:src-tauri/src/lib.rs†L638-L853】

## Behaviour of shared helpers
- `list_command` / `get_command` call `repo::list_active` / `repo::get_active`, guaranteeing `deleted_at IS NULL` and enforcing household scoping and order before converting rows to JSON values.【F:src-tauri/src/commands.rs†L669-L693】
- `create_command` injects a UUID, fills `created_at`/`updated_at`, validates that every column has a value, and returns the inserted payload. Missing fields trigger `COMMANDS/MISSING_FIELD` with the offending column in the context map.【F:src-tauri/src/commands.rs†L695-L734】
- `update_command` (not shown above) and `delete_command` call into `repo` to apply partial updates or soft-deletes, while `restore_command` clears `deleted_at` and renumbers positions for ordered tables such as `family_members`.【F:src-tauri/src/commands.rs†L695-L734】【F:src-tauri/src/commands.rs†L1120-L1138】【F:src-tauri/src/repo.rs†L300-L506】
- SQLx errors are normalised through `AppError::from_sqlx_ref`, which preserves the SQLite constraint name (e.g., the unique `(household_id, position)` index) when present.【F:src-tauri/src/error/mod.rs†L302-L328】

## Frontend invocation & error mapping
- The renderer calls these commands via `familyRepo` (`src/repos.ts`), which simply forwards arguments to `call("family_members_*", …)` and expects the full row on create. There is no local caching layer for the Family list.【F:src/repos.ts†L32-L107】
- The IPC adapter wraps errors with `normalizeError`, standardising `code`, `message`, and optional `context` before rethrowing. No additional UI handling is implemented in `FamilyView`, so errors surface only via rejected promises/console output.【F:src/lib/ipc/call.ts†L26-L110】【F:src/FamilyView.ts†L58-L145】
