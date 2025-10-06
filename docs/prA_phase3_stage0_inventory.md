# Phase 3.0 — Attachment Path Inventory

This stage audited the repository for attachment-related filesystem operations that still bypass the vault layer. The search focused on `.join(`, `PathBuf::from`, and direct `fs::` usage that build or touch attachment paths outside `src-tauri/src/vault/`.

## Commands

```
rg "\\.join\(" src-tauri/src -g'*.rs'
rg "PathBuf::from" src-tauri/src -g'*.rs'
rg "fs::" src-tauri/src -g'*.rs'
```

## Callsite Inventory

| Path | Function / Context | Action (planned follow-up) |
| --- | --- | --- |
| `src-tauri/src/lib.rs` | `resolve_import_paths` assembles `target_root.join("attachments")` for CLI/app flows. | Phase 3.2+ — swap manual joins for `Vault::resolve` output when wiring IPC + CLI entrypoints. |
| `src-tauri/src/lib.rs` | Import execution block calls `std::fs::create_dir_all(&attachments_root)` before invoking import executors. | Phase 3.2+ — move directory provisioning behind vault guard helpers and log via canonical codes. |
| `src-tauri/src/main.rs` | `default_attachments_path` builds the attachments directory via `PathBuf::from(fake).join("attachments")` / `base.join(...)`. | Phase 3.2 — resolve via shared vault instance or helper that delegates to the guard layer. |
| `src-tauri/src/main.rs` | `handle_db_import` pre-creates `default_attachments_path()` with `fs::create_dir_all`. | Phase 3.2 — replace with vault-backed path provisioning and guard-aware error mapping. |
| `src-tauri/src/main.rs` | `run_cli_import` threads the raw `attachments_root` into plan/execute contexts. | Phase 3.2 — plumb an `Arc<Vault>` through CLI import so downstream calls request resolved paths. |
| `src-tauri/src/import/plan.rs` | `plan_attachments_merge` joins `ctx.attachments_root.join(rel)` to probe live files. | Phase 3.1 — convert planning checks to use vault-resolved paths and guard error taxonomy. |
| `src-tauri/src/import/execute.rs` | `execute_attachments_replace` clears/creates `ctx.attachments_root` via direct `fs::remove_dir_all` / `fs::create_dir_all`. | Phase 3.1 — wrap replace-mode staging in vault-managed helpers with hashed-path logging. |
| `src-tauri/src/import/execute.rs` | `execute_attachments_merge` and `copy_attachment` join bundle-relative paths onto `ctx.attachments_root` and copy via `fs::copy`. | Phase 3.1 — resolve destinations through the vault and surface guard violations with canonical errors. |
| `src-tauri/src/export/mod.rs` | Export pipeline (`resolve_attachments_base`, `copy_attachments_and_build_manifests`) builds joins between the app attachments base and export staging dirs, performing direct `fs::` IO. | Phase 3.4 — delegate base resolution + copy targets to vault helpers and normalize manifest logging. |
| `src-tauri/src/export/mod.rs` | `estimate_export_size` walks `attachments_base` directly via `dir_size`. | Phase 3.4 — fetch directory handles via vault accessors before measuring disk usage. |

## Notes

* Tests and fixtures under `#[cfg(test)]` were not exhaustively listed; they will be revisited once production call sites are vaulted.
* Phase 3.1 should begin with the import modules because they currently own the majority of joins against the live attachments root.

## Phase 3.5 Verification

| Path | Resolution |
| --- | --- |
| `src-tauri/src/lib.rs` (`resolve_import_paths`) | Function now returns the database parent directory and reports folder only; attachment work happens through the shared vault handle passed into import planning/execution.【F:src-tauri/src/lib.rs†L2026-L2055】【F:src-tauri/src/lib.rs†L2160-L2166】 |
| `src-tauri/src/lib.rs` bootstrap | Startup derives the attachments root once before instantiating the single runtime `Arc<Vault>` that services all attachment consumers.【F:src-tauri/src/lib.rs†L3884-L3928】 |
| `src-tauri/src/main.rs` CLI flows | Import/export commands create the attachments directory, construct an `Arc<Vault>`, and reuse it for the entire operation; the default helper only expands the OS data directory into `attachments`.【F:src-tauri/src/main.rs†L349-L375】【F:src-tauri/src/main.rs†L546-L579】【F:src-tauri/src/main.rs†L827-L835】 |
| `src-tauri/src/import/plan.rs` | Planning loops resolve every attachment through `ctx.vault.resolve`, hashing both the relative path and destination for guard-compliant logging.【F:src-tauri/src/import/plan.rs†L315-L339】 |
| `src-tauri/src/import/execute.rs` | Replace/merge execution uses `vault.resolve` to obtain destinations and logs hashed identifiers before copying bundle attachments.【F:src-tauri/src/import/execute.rs†L583-L719】 |
| `src-tauri/src/export/mod.rs` | Export routines resolve attachment sources through the vault and guard copy targets, emitting hashed manifests and warnings for missing files.【F:src-tauri/src/export/mod.rs†L272-L358】 |
