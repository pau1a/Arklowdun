# Vault Enforcement Invariants

This document captures the runtime contract introduced in PR A, ensuring every attachment read or mutation passes
through a single, guard-protected vault resolver.

## Runtime contract

- `AppState` exposes a single `Arc<Vault>` that every command, background job, and CLI routine clones when it needs to
  interact with attachments. Reconstructing the vault with raw filesystem paths is forbidden.
- The vault owns the canonical attachments root and applies guard validation in `Vault::resolve` before returning a
  filesystem path.
- Callers must provide household context and attachment category so the guard can enforce the correct directory layout
  and error taxonomy.

## Guard pipeline

`vault::guard` centralises the following checks:

1. Normalize the relative path (Unicode NFC, collapse redundant separators, reject absolute paths).
2. Validate every component against the filename policy and maximum length rules.
3. Reject traversal sequences, symlinks, and attempts to escape the attachments root.
4. Emit canonical error codes (`ERR_PATH_OUT_OF_VAULT`, `ERR_SYMLINK_DENIED`, `ERR_FILENAME_INVALID`, etc.) for any
   failure so IPC and CLI layers surface consistent responses.

Any code interacting with attachments should call `Vault::resolve` and never manipulate `PathBuf` segments manually.

## Logging and telemetry

Guard rejections emit the `vault_guard_denied` event with hashed relative paths, household/category metadata, and the
stage that failed. Successful resolutions stay silent unless higher-level callers choose to log context-specific
information. No logs may contain raw attachment paths.

## Developer checklist

When adding a new attachment feature:

1. Accept an `Arc<Vault>` in the constructor or use `AppState::vault.clone()` within Tauri commands.
2. Call `vault.resolve(&household, category, &relative_path)` to obtain a validated path.
3. Bubble up `AppError` values from the vault unchanged so the UI can map canonical guard codes.
4. Add guard-coverage tests for traversal, symlink, and invalid-component cases relevant to the new flow.
