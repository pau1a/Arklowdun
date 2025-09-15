# IPC Security Playbook

- [ ] Used canonicalize_and_verify + reject_symlinks
- [ ] Logged via log_fs_ok/log_fs_deny
- [ ] No raw paths in logs or UI
- [ ] UI calls presentFsError
- [ ] Tests pass (cargo test -p arklowdun)

## Purpose

All file system access in Arklowdun must flow through the Rust confinement helpers.
This playbook defines the rules for path validation, logging, and the UI error
contract. Bypassing these rules is a security violation.

## Enforcement Rules

- **Canonicalization**: every IPC entrypoint that accepts a path must call
  `fs_policy::canonicalize_and_verify()` followed by
  `fs_policy::reject_symlinks()`.
- **Roots**: access must be scoped under `RootKey::{AppData|Attachments}`.
- **Rejections**: requests are denied for UNC paths, `..`, cross-volume paths on
  Windows, outside-root access, symlinks, invalid inputs, or I/O errors.

## Logging Contract

Every check emits a `fs_guard_check` event.

- On success log `{"target":"arklowdun","event":"fs_guard_check","ok":true,"root":"AppData","path_hash":"abc123"}`
  with `{ ok: true, root, path_hash }`.
- On denial log `{"target":"arklowdun","event":"fs_guard_check","ok":false,"root":"Attachments","code":"NOT_ALLOWED","reason":"Symlink"}`
  with `{ ok: false, root, code, reason }`.
- Logs must never include raw paths. Only `hash_path()` is permitted.

## Error Contract to UI

Errors exposed across IPC are shaped as `UiError`.

```ts
export type FsUiError =
  | { code: 'NOT_ALLOWED'; message: string }
  | { code: 'INVALID_INPUT'; message: string }
  | { code: 'IO/GENERIC'; message: string };
```

The UI surfaces filesystem issues via `presentFsError()` and uses the following
messages:

- `NOT_ALLOWED` → “That location isn’t allowed”
- `INVALID_INPUT` → “Invalid path”
- `IO/GENERIC` → “File error”

No raw paths or filesystem details may appear in user-visible toasts.

## Developer Notes

- Never use `@tauri-apps/plugin-fs` directly. `npm run check:plugin-fs`
  enforces this rule.
- All filesystem code lives in the Rust confinement helpers, not in TypeScript.
- New error variants in `FsPolicyError` must implement `.name()` and map to a
  `FsUiError`.

## Testing & Validation

- Redaction is enforced by `tests/log_redaction.rs`.
- All filesystem policy invariants are covered by `security::fs_policy_tests`.
- Before merging, run `cargo test -p arklowdun` and ensure all tests pass.

