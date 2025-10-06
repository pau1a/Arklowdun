# PR A — Phase 0 Discovery Report

## Attachment Code Path Inventory

### IPC Commands
| Entry point | Responsibility | Guard / path handling notes |
| --- | --- | --- |
| `commands::prepare_attachment_create` | Normalises incoming attachment payloads during record creation and requires category + household metadata. | Requires a `Vault` instance, parses `AttachmentCategory`, and rewrites `relative_path` via `vault.resolve` + `relative_from_resolved`. Guard errors propagate directly to the caller.【F:src-tauri/src/commands.rs†L780-L857】 |
| `commands::prepare_attachment_update` | Applies the same validation when editing existing attachment-backed rows. | Resolves the current or provided category, enforces household presence, and pushes all non-empty `relative_path` updates through `vault.resolve`.【F:src-tauri/src/commands.rs†L859-L972】 |
| `commands::delete_command` | Cleans up attachment files when deleting records. | Fetches the attachment descriptor, resolves it through the vault, and removes the resolved file if present while surfacing guard failures with structured context.【F:src-tauri/src/commands.rs†L1113-L1156】 |
| `lib::attachment_open` | Opens an attachment in the default OS handler. | Loads descriptor metadata, verifies the active household, resolves the vault path once, and delegates to `attachments::open_with_os`. Guard denials log hashed context via `log_vault_error`.【F:src-tauri/src/lib.rs†L2760-L2813】 |
| `lib::attachment_reveal` | Reveals an attachment in the file manager. | Shares the same resolution and guard flow as `attachment_open`, ending with `attachments::reveal_with_os`.【F:src-tauri/src/lib.rs†L2816-L2867】 |
| `lib::attachments_migrate` | Dispatches the vault migration task over IPC. | Reuses the `AppState` vault instance and defers guard logic to `vault_migration::run_vault_migration` within the async job. 【F:src-tauri/src/lib.rs†L2880-L2893】 |

### Background Jobs, CLI Utilities, and Services
| Module | Responsibility | Path handling observations |
| --- | --- | --- |
| `attachments::load_attachment_descriptor` | Central query helper for attachment metadata. | Validates presence of household/category/relative path, maps category strings into `AttachmentCategory`, and returns the vault coordinates consumed by IPC handlers.【F:src-tauri/src/attachments.rs†L18-L133】 |
| `export::copy_attachments_and_build_manifests` | Packages attachment payloads during exports. | Iterates DB-referenced relative paths, joins them to the attachments base, copies into an export directory, and records manifest hashes—currently performs raw `PathBuf::join` operations outside the vault guard. 【F:src-tauri/src/export/mod.rs†L276-L345】 |
| `import::plan::ensure_safe_relative_path` | Plans attachment actions for bundle imports. | Rejects absolute or parent-traversing paths before scheduling copy work, but does not normalise separators or enforce component rules beyond traversal. 【F:src-tauri/src/import/plan.rs†L520-L529】 |
| `import::execute::execute_attachments_*` | Executes attachment copy/merge steps during imports. | Deletes/creates attachment directories, calls `ensure_safe_relative_path`, and writes files directly under the computed root. Guard coverage currently depends on these ad-hoc checks. 【F:src-tauri/src/import/execute.rs†L524-L605】 |
| `security::fs_policy` helpers | Allows non-vault file interactions (e.g., diagnostics, open_path). | Provides `canonicalize_and_verify` and `reject_symlinks` routines used by CLI/diagnostic commands; these operate independently from the vault’s attachment-specific guards. 【F:src-tauri/src/security/fs_policy.rs†L1-L133】 |

## Guard Helper Baseline
- `Vault::resolve` is the sole attachment guard entrypoint today. It enforces household/category validity, normalises relative paths, applies component/length rules, and re-checks for symlinks before logging hashed allow/deny events.【F:src-tauri/src/vault/mod.rs†L24-L115】
- Guard subroutines within `Vault` include `normalize_relative`, `validate_component`, `ensure_path_length`, and `reject_symlinks`. These helpers are private to the vault and are only invoked through `Vault::resolve` / `relative_from_resolved`.【F:src-tauri/src/vault/guard.rs†L14-L110】
- Separate guard implementations exist in other subsystems:
  - Import planning/execution uses `ensure_safe_relative_path` to block traversal but lacks the vault’s component validation and logging.【F:src-tauri/src/import/plan.rs†L520-L529】【F:src-tauri/src/import/execute.rs†L554-L605】
  - The filesystem policy module exposes `canonicalize_and_verify` + `reject_symlinks` for general-purpose path handling (e.g., diagnostics, non-attachment access). These routines duplicate some vault behaviour but live outside the attachment flow.【F:src-tauri/src/security/fs_policy.rs†L76-L133】

## Baseline Test & Benchmark Snapshot
- `cargo test --manifest-path src-tauri/Cargo.toml` *(fails: missing `glib-2.0` system library required by `glib-sys` build script)*.【f6929f†L1-L32】

> The failing dependency indicates that future vault changes will require either vendor tooling for GNOME dependencies or container images with GTK/Glib development packages. No other automated suites were executed in this phase.

## Outstanding Questions for Phase 1+
1. Import/export flows currently bypass the vault guard entirely. Should subsequent phases wrap these operations around `Vault::resolve` or introduce equivalent guard utilities?
2. The import planners duplicate relative-path checks—decide whether to consolidate them into the vault guard module or expose a shared helper for bundle validation.
3. Establish a portable strategy for satisfying GTK/Glib build dependencies inside CI so Rust integration tests run consistently.
