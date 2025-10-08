# Diagnostics & logging

## Logging configuration
- The Tauri runtime configures rotating JSON logs with a 5 MB max size and five retained files, stored under `logs/arklowdun.log`. These constants live at the top of `src-tauri/src/lib.rs` and apply globally, including Family operations.【F:src-tauri/src/lib.rs†L56-L120】
- No additional tracing or structured log events are emitted by the Family IPC handlers; the generated functions call the shared command helpers without invoking `tracing::*` macros.【F:src-tauri/src/lib.rs†L638-L853】

## Health & diagnostics surfaces
- Household diagnostics collect table counts under the alias `familyMembers`, ensuring support bundles report active row totals for the module.【F:src-tauri/src/diagnostics.rs†L90-L116】
- Database exports include `family_members` in the list of tables dumped with `deleted_at IS NULL`, so backups and support packages capture the current active roster.【F:src-tauri/src/export/mod.rs†L224-L268】
- Hard-repair and cascade-delete routines treat `family_members` as one of the phase tables, so repair telemetry covers the Family dataset along with other household-scoped domains.【F:src-tauri/src/household.rs†L380-L418】

## Database environment reporting
- When the SQLite pool is created, the code enforces `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, sets `busy_timeout = 5000`, and calls `log_effective_pragmas` to record the observed values—these settings apply to every Family query executed through the shared pool.【F:src-tauri/src/db.rs†L139-L219】

Overall, Family contributes diagnostic counts and appears in export manifests, but it does not yet emit any module-specific logs beyond the shared infrastructure described above.
