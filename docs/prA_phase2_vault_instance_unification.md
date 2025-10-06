# PR A — Phase 2 Vault Instance Unification

## Summary
- Anchored the runtime around a single `Arc<Vault>` stored on `AppState`, allowing callers to clone the shared resolver instead of duplicating attachment root paths. Phase 3.5 removed the temporary `attachments_root(_arc)` helpers so the vault itself remains the only public entrypoint.【F:src-tauri/src/state.rs†L12-L72】
- Moved the vault base directory into an `Arc<PathBuf>` and exposed `base_arc()` so every consumer shares the same canonical root without re-allocation.【F:src-tauri/src/vault/mod.rs†L1-L63】
- Added a regression test that proves cloned `AppState` handles reference the same vault instance and surface the vault-managed root path.【F:src-tauri/src/state.rs†L94-L133】

## Follow-ups
- Consider a lightweight builder for `AppState` to reduce the repeated struct literal boilerplate once the vault plumbing stabilises.
