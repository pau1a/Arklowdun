# PR A — Vault Enforcement Completeness Work Plan

This document breaks the PR specification into sequential, reviewable sub-tasks. Each phase can land in an independent pull request and leaves the codebase in a consistent state. Later phases build on earlier ones, so the order should be preserved.

## Phase 0 – Discovery & Baseline Tests
- Catalogue every current attachment code path (IPC handlers, background jobs, CLI utilities).
- Record existing guard helpers and their call sites.
- Capture baseline test + benchmark runs (`cargo test`, targeted integration suites) to detect regressions later.
- Outcome: shared checklist of touch points and current behaviour.

## Phase 1 – Vault Guard Consolidation
- Centralise `normalize_relative`, `reject_symlinks`, `validate_component`, `ensure_path_length`, and related helpers inside `vault::guard` (or a dedicated submodule).
- Add comprehensive unit tests for each guard scenario (absolute path rejection, traversal, symlink, reserved names, over-length components).
- Update `vault.rs` to re-export the guard API and remove duplicate implementations elsewhere.
- Outcome: one authoritative guard implementation plus automated coverage.

## Phase 2 – Vault Instance Unification
- Adjust application bootstrap (`lib.rs`, `state.rs`, Tauri commands) so a single `Vault` instance lives in `AppState` and is shared via clones or handles.
- Remove redundant `pub mod vault` declarations and conflicting re-exports.
- Update constructors/tests to use the unified instance.
- Outcome: runtime owns exactly one vault instance with clear usage ergonomics.

## Phase 3 – Guarded Vault Resolution Plumbing
- Audit all filesystem operations touching attachments (`.join`, `PathBuf::from`, direct `fs::` calls).
- Replace ad-hoc path construction with `vault.resolve()` and guard-returned paths.
- Ensure guard errors use canonical constants (e.g., `ERR_PATH_OUT_OF_VAULT`, `ERR_SYMLINK_DENIED`, `ERR_FILENAME_INVALID`).
- Outcome: every code path routes through the guard-aware resolver; error taxonomy is consistent.

## Phase 4 – IPC Entry Point Hardening
- For each IPC handler (`attachment_open`, `attachment_reveal`, `prepare_attachment_create`, `prepare_attachment_update`, `delete_command`, etc.):
  - Validate the attachment category via `AttachmentCategory::from_str` (or equivalent typed parsing) before touching the vault.
  - Invoke `vault.resolve()` exactly once, propagating guard errors.
  - Adjust tests to assert the validation + resolution flow and correct error codes.
- Outcome: uniform front-door validation behaviour and end-to-end tests.

## Phase 5 – Logging & Telemetry Alignment
- Introduce structured logging (`info!`, `warn!`, `error!`) around guard allow/deny decisions with hashed paths and category/household context only.
- Remove bespoke log strings and ensure all guard-related errors use canonical constants.
- Outcome: observable, scrubbed logs suitable for monitoring.

## Phase 6 – Integration & Performance Validation
- Expand integration tests to exercise attachment CRUD per category using the unified vault.
- Add negative-path tests (absolute paths, traversal, invalid categories) asserting correct error codes and logging.
- Run performance benchmarks to confirm `vault.resolve()` latency target (≤ 5 ms under load) and document results.
- Outcome: verified correctness and performance confidence.

## Phase 7 – Final Acceptance Checklist Review
- Reconcile the spec’s acceptance checklist against implemented work.
- Confirm no stray `PathBuf::join`/`fs::` usages remain outside the vault module.
- Ensure documentation (developer guide, README snippets) reflects the new invariants.
- Outcome: sign-off package summarising compliance and next steps.
- ✅ Completed in [Phase 7 acceptance](prA_phase7_acceptance.md), which records the audit results and documentation refresh.

## Dependencies & Sequencing Notes
- Later phases rely on earlier guard and vault changes; avoid reordering unless scoped adjustments are needed.
- Each phase should land with tests updated and passing to maintain stability.
- Coordinate with adjacent PRs (e.g., PR 1A, PR B/C) to avoid overlapping migration or schema changes.

