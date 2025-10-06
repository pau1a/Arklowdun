# PR A — Phase 3.5: Final Audit & Cleanup

## Objective

Confirm that every attachment entrypoint now routes through the canonical
`Vault::resolve` guard chain, remove helper surfaces that allowed callers to
bypass the vault, and capture the final verification results for Phase 3 of
PR A.

## Audit Summary

| Callsite | Resolution |
| --- | --- |
| `src-tauri/src/lib.rs` bootstrap | Application startup now instantiates a single `Arc<Vault>` alongside the SQLite pool, and the only remaining join derives the canonical attachments root before the vault is constructed. All downstream consumers clone the shared vault handle.【F:src-tauri/src/lib.rs†L3884-L3928】 |
| CLI import/export (`src-tauri/src/main.rs`) | The CLI prepares the attachments directory once, constructs an `Arc<Vault>` with that root, and threads the shared resolver into import/export routines; the default path helper merely expands the OS data directory.【F:src-tauri/src/main.rs†L349-L375】【F:src-tauri/src/main.rs†L827-L835】 |
| Import planning (`src-tauri/src/import/plan.rs`) | Planning uses `ctx.vault.resolve(...)` for every attachment, hashing both the relative path and resolved destination for logging before making any filesystem calls.【F:src-tauri/src/import/plan.rs†L315-L339】 |
| Import execution (`src-tauri/src/import/execute.rs`) | Replace and merge flows obtain destinations via `vault.resolve`, and the copy helper logs hashed identifiers when staging bundle files.【F:src-tauri/src/import/execute.rs†L583-L719】 |
| Export pipeline (`src-tauri/src/export/mod.rs`) | Background export tasks resolve attachment sources through the shared vault, hash both the manifest key and resolved path, and only manipulate filesystem state after guard approval.【F:src-tauri/src/export/mod.rs†L272-L358】 |
| IPC import helpers (`src-tauri/src/lib.rs`) | IPC preview/execute commands clone the runtime vault and pass it into planning/execution contexts, ensuring front-end imports cannot bypass guard enforcement.【F:src-tauri/src/lib.rs†L2026-L2055】【F:src-tauri/src/lib.rs†L2075-L2099】 |

## Cleanup

- Removed the `AppState::attachments_root` and `AppState::attachments_root_arc`
  helpers so callers must request the shared vault handle instead of touching the
  filesystem root directly.【F:src-tauri/src/state.rs†L1-L117】

## Testing

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml` *(fails: system `glib-2.0` dependency is still missing in the container)*
