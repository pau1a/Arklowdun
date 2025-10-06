# PR A — Phase 7: Acceptance Checklist Review

## Summary

Phase 7 closes out the Vault Enforcement Completeness effort by reconciling the acceptance checklist against the
codebase as of this change. We audited the repository for stray filesystem joins, confirmed logging/guard invariants,
and refreshed developer documentation so the runtime contract is obvious to future contributors.

## Acceptance checklist status

- [x] **All attachment IPC commands call `vault.resolve()` exactly once.** Verified by reviewing
  `src-tauri/src/commands.rs` and confirming the shared `AttachmentMutationGuard` and read helpers are used across
  every invocation path.【F:src-tauri/src/commands.rs†L18-L190】
- [x] **All file operations funnel through unified guards.** Imports, exports, IPC, and CLI helpers now request
  resolved paths from `Vault`, which internally applies `vault::guard` before returning a filesystem path.【F:src-tauri/src/vault/mod.rs†L1-L284】【F:src-tauri/src/vault/guard.rs†L1-L221】
- [x] **Single `Vault` instance declared and managed in `AppState`.** Runtime bootstrap wires an `Arc<Vault>` into
  `AppState`, while helper constructors and tests clone that handle instead of rebuilding vault instances.【F:src-tauri/src/lib.rs†L3888-L4177】【F:src-tauri/src/state.rs†L1-L120】
- [x] **All errors use canonical guard constants.** Guard failures bubble up via the predefined error codes in
  `vault::guard` and `Vault::resolve`, ensuring IPC surfaces `ERR_PATH_OUT_OF_VAULT`, `ERR_SYMLINK_DENIED`, and
  peers consistently.【F:src-tauri/src/vault/mod.rs†L120-L231】
- [x] **No duplicate module imports or re-exports remain.** Vault access is centralised under `crate::vault`; there
  are no residual `pub mod vault;` declarations or alternate exports in the tree.【F:src-tauri/src/lib.rs†L38-L84】
- [x] **Guard and validation tests exist and pass.** The repository contains unit and Tokio tests for guard helpers,
  IPC reads, mutation commands, and import/export resolution flows. They currently fail only when the system
  `glib-2.0` dependency is unavailable, matching the documented baseline.【F:docs/prA_phase6_integration_validation.md†L6-L12】【F:src-tauri/src/vault/guard.rs†L124-L221】
- [x] **Logging emits hashed identifiers with consistent event keys.** Guard denials emit `vault_guard_denied`
  events carrying hashed relative paths, household IDs, and guard stages; IPC mismatches reuse the same helper so
  logs never include raw filesystem paths.【F:src-tauri/src/vault/mod.rs†L188-L231】【F:src-tauri/src/commands.rs†L120-L190】
- [x] **Performance and latency within target bounds.** The concurrent benchmark added in Phase 6 keeps
  `Vault::resolve` under the 5 ms SLA with a 64-task workload, and no regressions were observed during this audit.【F:docs/prA_phase6_integration_validation.md†L13-L17】

## Repository audit

```
$ rg '\.join\(' src-tauri/src --glob '!vault/**' --glob '!**/*.rs' -g'*.rs'
$ rg 'PathBuf::from' src-tauri/src --glob '!vault/**'
$ rg 'std::fs::' src-tauri/src --glob '!vault/**'
```

The first pass isolates `.join(` usage outside `vault/`; every hit either constructs export bundle directories or
operates on temporary test fixtures—not the runtime attachment tree. The subsequent searches show `PathBuf::from`
and `std::fs::` usages outside the vault module are confined to bundle validation, diagnostics tooling, or bootstrap
routines that precede vault initialisation. No attachment read/write path bypasses the guard chain.

## Documentation updates

- Added `docs/architecture/vault-enforcement.md` to describe the single-vault runtime contract, guard helpers, and
  logging requirements for attachment consumers.
- Linked the new architecture note from `README.md` so developers land on the guard expectations during onboarding.
- Refreshed the work plan with a pointer to this acceptance report for traceability.

## Next steps

The Vault enforcement perimeter is now fully documented and instrumented. Follow-up hardening lives outside PR A—
notably frontend parity (PR C) and extended housekeeping checks (PR B). Routine maintenance should keep the
acceptance checklist in CI to prevent regression.
