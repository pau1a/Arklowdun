# PR A — Phase 1 Guard Consolidation

## Summary
- Extracted the attachment guard helpers into a dedicated `vault::guard` module and re-exported them from the vault entrypoint so other subsystems can consume a single implementation.【F:src-tauri/src/vault/mod.rs†L10-L21】【F:src-tauri/src/vault/guard.rs†L9-L126】
- Added targeted unit tests covering absolute paths, traversal, reserved names, over-long components, symlink segments, and Unicode normalisation to lock in guard behaviour.【F:src-tauri/src/vault/guard.rs†L147-L218】
- Updated the import planning and execution pipelines to reuse the vault guards instead of maintaining bespoke path checks, aligning their errors with the canonical guard codes.【F:src-tauri/src/import/plan.rs†L4-L11】【F:src-tauri/src/import/plan.rs†L526-L541】【F:src-tauri/src/import/execute.rs†L1-L15】【F:src-tauri/src/import/execute.rs†L893-L909】

## Follow-ups
- Review downstream attachment consumers (export routines, background jobs) and switch them to the shared guard module where applicable during later phases.
- Decide whether import/export error types should expose the guard code separately from the formatted path string for richer telemetry.
