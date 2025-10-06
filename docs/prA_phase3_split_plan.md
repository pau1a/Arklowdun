# Phase 3 Work Breakdown — Guarded Vault Resolution Plumbing

This document subdivides Phase 3 of PR A into sequential, reviewable slices so the end state matches the original specification while keeping each change set tractable.

## Stage 3.0 — Repo-wide Join Inventory
- Use `rg "\.join\("`, `rg "PathBuf::from"`, and `rg "fs::"` to catalogue every attachment-related filesystem call site outside `vault/`.
- Produce a short tracking table (path, function, action) committed under `docs/`.
- Outcome: agreed-upon list of targets with ownership notes.

## Stage 3.1 — Import & CLI Attachment Paths
- Update import planning/execution modules to replace direct joins with `vault.resolve()` (or helpers returning vault-validated paths).
- Wire guard errors to canonical constants; ensure logging uses hashed identifiers.
- Add focused unit tests covering the converted surfaces.
- Outcome: import/CLI flows exclusively consume vault-validated paths.

## Stage 3.2 — IPC Attachment Reads (Open/Reveals)
- Patch IPC handlers that expose attachment paths (`attachment_open`, `attachment_reveal`) to resolve via the shared `Vault` instance.
- Confirm guard rejection paths bubble correct `AppError` variants.
- Extend existing IPC tests (or add new ones) validating rejection of traversal/absolute inputs.
- Outcome: front-door read pathways cannot bypass the guard layer.

## Stage 3.3 — IPC Attachment Mutations (Create/Update/Delete)
- Apply the same vault resolution plumbing to create/update/delete commands, ensuring exactly one `vault.resolve()` invocation per request.
- Normalize temporary file handling so staging uses vault-provided paths only.
- Expand test coverage for invalid filename/category cases hitting guard constants.
- Outcome: all IPC mutations depend on the canonical resolver.

## Stage 3.4 — Background Jobs & Workers
- Identify background consumers (sync, cleanup, housekeeping) still performing manual joins.
- Introduce vault-driven resolution APIs where necessary, adjusting task-specific logging and metrics.
- Add regression tests or fixtures for scheduled jobs that touch attachments.
- Outcome: asynchronous flows are aligned with guard enforcement.

## Stage 3.5 — Final Audit & Cleanup
- Re-run the repo-wide join inventory to ensure only sanctioned usages remain (e.g., inside `vault/`).
- Remove obsolete helper functions and update documentation to reflect the new invariants.
- Capture a Phase 3 summary document referencing converted call sites and test results.
- Outcome: verified completion of the guarded resolution rollout, enabling Phase 4.

## Sequencing Notes
- Each stage should land independently with passing tests to simplify review and rollback.
- Prioritize areas with the highest user impact (import + IPC reads) before background maintenance flows.
- Coordinate with Phase 4 plans so entrypoint validation changes build on the newly unified resolver pathways.
