# Family module baseline documentation

This directory captures how the Family area behaves **as shipped today**, spanning storage, IPC, UI, and diagnostics. It is the frozen reference point for upcoming feature work.

## Quick links
- [Architecture](architecture.md)
- [Database](database.md)
- [IPC contracts](ipc.md)
- [Frontend behaviour](frontend.md)
- [Diagnostics & logging](diagnostics.md)
- [Changelog](changelog.md)

## Snapshot highlights
- The Rust command surface exposes six generic `family_members_*` handlers generated in `src-tauri/src/lib.rs`; they delegate straight into the shared command helpers without extra logging.【F:src-tauri/src/lib.rs†L638-L853】
- TypeScript talks to those commands through `familyRepo` in `src/repos.ts`, which applies the `"position, created_at, id"` ordering for every list call.【F:src/repos.ts†L32-L107】
- The web UI is implemented entirely in `src/FamilyView.ts`, which mounts a `<section>` inside the supplied container, renders the list/form markup with `innerHTML`, and wires event listeners per element.【F:src/FamilyView.ts†L20-L145】
- Persistent data lives in the `family_members` table defined in the baseline migration and `schema.sql`, with `position INTEGER NOT NULL DEFAULT 0` plus a filtered uniqueness index on `(household_id, position)`.【F:migrations/0001_baseline.sql†L129-L139】【F:schema.sql†L115-L125】【F:schema.sql†L273-L274】
- Diagnostics currently surface Family only via aggregate counts (`familyMembers`) and export routines; no dedicated log events are emitted when the commands run.【F:src-tauri/src/diagnostics.rs†L90-L116】【F:src-tauri/src/lib.rs†L638-L853】【F:src-tauri/src/export/mod.rs†L224-L268】

## Known limitations (documented facts)
- There is no user-facing error messaging: the create path lacks a `try/catch`, and the update handlers swallow errors silently.【F:src/FamilyView.ts†L58-L145】
- Family has no automated coverage; a repository search for `family_members` inside `tests/` returns no matches (ripgrep exits with status 1).【6d1e6d†L1-L3】
- The module has no dedicated styling or shared components beyond layout/banner plumbing; no selectors for `family` exist in the global stylesheet, and routing simply mounts the legacy view under the hidden navigation group.【F:src/styles.scss†L392-L3872】【F:src/routes.ts†L1-L260】
- There are no reordering controls or additional IPC endpoints beyond the CRUD set; the UI only lists, creates, and opens members, and the backend exposes the generic helpers listed above.【F:src/FamilyView.ts†L41-L145】【F:src-tauri/src/lib.rs†L638-L853】
