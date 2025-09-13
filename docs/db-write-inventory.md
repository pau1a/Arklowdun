| Domain | Function | File:Line | Tables | Has existing txn? | Calls other writers? | Notes |
|---|---|---|---|---|---|---|
| OUT OF SCOPE | default_household_id | src-tauri/src/household.rs:8 | household | No | No | Creates default household when missing |
| OUT OF SCOPE | create | src-tauri/src/commands.rs:108 | * | No | No | Generic insert |
| OUT OF SCOPE | update | src-tauri/src/commands.rs:140 | * | No | No | Generic update |
| OUT OF SCOPE | create_command | src-tauri/src/commands.rs:222 | * | No | Yes (create) | Wrapper command |
| OUT OF SCOPE | update_command | src-tauri/src/commands.rs:231 | * | No | Yes (update) | Wrapper command |
| OUT OF SCOPE | delete_command | src-tauri/src/commands.rs:244 | * | No | Yes (set_deleted_at) | Soft delete |
| OUT OF SCOPE | restore_command | src-tauri/src/commands.rs:256 | * | No | Yes (clear_deleted_at) | Restore soft-deleted row |
| OUT OF SCOPE | set_deleted_at | src-tauri/src/repo.rs:180 | * | No | Yes (renumber_positions) | Marks row deleted |
| OUT OF SCOPE | clear_deleted_at | src-tauri/src/repo.rs:219 | * | No | Yes (renumber_positions) | Restores row |
| ordering | renumber_positions | src-tauri/src/repo.rs:252 | * | No | No | Reindexes positions |
| ordering | reorder_positions | src-tauri/src/repo.rs:283 | * | Yes | Yes (renumber_positions) | Batch reorder |
| notes | bring_note_to_front | src-tauri/src/repo.rs:328 | notes | No | No | Increment note z-order |
| OUT OF SCOPE | events_backfill_timezone | src-tauri/src/events_tz_backfill.rs:46 | events | Yes | No | Backfills tz and UTC times |
| OUT OF SCOPE | apply_migrations | src-tauri/src/migrate.rs:180 | schema_migrations | Yes | No | Applies pending migrations |
| OUT OF SCOPE | revert_last_migration | src-tauri/src/migrate.rs:369 | schema_migrations | Yes | No | Rolls back last migration |
| OUT OF SCOPE | open_sqlite_pool | src-tauri/src/db.rs:8 | PRAGMA | No | No | Sets PRAGMA defaults on connection |

> **TODO:** Idempotent retries for cross-domain writes are currently unsupported. Deterministic inserts without conflict handling (e.g., `order_items`) will roll back on conflict; future design should add upsert semantics for all entities.
