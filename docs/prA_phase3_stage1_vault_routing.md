# PR A — Phase 3.1: Import Vault Routing

## Objective

Route every import planning and execution path through the canonical `Vault` so that
attachment copies, comparisons, and logging reuse the shared guard layer introduced in
Phases 1 and 2.

## Implemented Changes

- Added `import::metadata::collect_bundle_attachment_updates` so both the plan and
  execution flows share a single implementation for reading attachment timestamps from
  bundle data tables. The helper surfaces consistent `MetadataIssue` errors that map into
  the existing plan/execution error types.
- Updated `PlanContext` and `ExecutionContext` consumers to require an `Arc<Vault>` and
  replaced ad-hoc filesystem joins with `vault.resolve` lookups. Logging now hashes both
  the relative path and resolved destination for observability without leaking raw paths.
- Reworked import merge logic to resolve bundle metadata once per bundle, compute the
  per-relative-path `updated_at` map via the shared helper, and pass those results into
  attachment planning and execution.
- Adjusted CLI and IPC entrypoints to clone the single runtime vault instance when
  running import validation, planning, and execution.
- Expanded plan/execution tests to include household/category metadata, resolve
  attachment destinations via the vault, and assert guard-enforced behaviours.

## Follow-Ups

- Validate downstream (Phase 3.2+) consumers compile against the updated
  `PlanContext`/`ExecutionContext` signatures.
- Add integration tests once the CI environment provides the `glib-2.0` dependency so
  the full `cargo test` suite can execute.
