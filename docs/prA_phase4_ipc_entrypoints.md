# PR A — Phase 4: IPC Entry Point Hardening

## Objective

Guarantee that every attachment-facing IPC command performs canonical
validation before delegating to the filesystem or database. This phase hardens
the front-door command handlers so the guard chain engaged in Phase 3 is now
the only path accessible to the desktop application.

## Implemented Changes

- Reused the shared `ensure_active_household_for_ipc` helper inside
  `resolve_attachment_for_ipc_read` so all IPC paths log hashed identifiers and
  emit the canonical household mismatch error code with consistent context
  before the vault is touched.【F:src-tauri/src/lib.rs†L2796-L2822】
- Added dedicated IPC command tests that exercise the Tauri invoke plumbing and
  prove invalid categories and active-household mismatches are rejected with the
  guard’s canonical error codes before any OS calls are made.【F:src-tauri/src/lib.rs†L4371-L4484】
- Provisioned deterministic test app state builders so front-end flows always
  consume the shared runtime vault and health state used elsewhere in the
  application.【F:src-tauri/src/lib.rs†L4394-L4416】

## Follow-Ups

- Phase 5 will layer structured logging on top of the newly unified entrypoint
  behaviour so both allow and deny paths emit hashed vault context for
  observability.
- Once the CI environment ships the missing `glib-2.0` dependency we should run
  the newly added IPC command tests in the pipeline to watch for regressions.
