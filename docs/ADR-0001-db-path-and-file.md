# ADR-0001 — DB path & file strategy

**Status:** Accepted  
**Context:** We are replacing JSON storage with SQLite in a Tauri v2 desktop app.

## Decision
- Use a **single SQLite file per install** (one DB file per user account).
- Model households in-schema: every domain table has **`household_id`**.
- Store the DB at **appDataDir()** (already app-scoped in Tauri v2), filename **`arklowdun.sqlite3`**.
- On open, set pragmas: `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`.
- Migrations: timestamped IDs `YYYYMMDDhhmm_label`, **idempotent**, one transaction each; record versions and checksums in table `schema_migrations`.

## Rationale
- One file = trivial backup/restore and portable WAL behavior.
- `household_id` unlocks multi-household and future cloud sync without schema contortions.
- `appDataDir()` avoids sandbox/permission weirdness; per-user on macOS/Windows/Linux.
- `synchronous=FULL` favors durability over write throughput, which is fine for a desktop app.

## Consequences
- Backups can use `VACUUM INTO backup.sqlite` and keep a small rotation.
- No DB encryption yet (revisit with auth/cloud).
- **No extra subfolder** under appDataDir (v2 already returns an app-scoped dir like `~/Library/Application Support/com.paula.arklowdun`).
