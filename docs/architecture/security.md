# Safe filesystem wrapper

All TypeScript code must import filesystem operations from `src/files/safe-fs.ts`.
This wrapper enforces canonicalization and the v1 symlink-deny policy before
accessing disk. The wrapper also re-exports `RootKey` and `PathError` for
convenience.

## Filesystem guardrail

All TS file I/O must use `src/files/safe-fs.ts`. Direct imports of
`@tauri-apps/plugin-fs` are forbidden across `src/**`, except in:

- `src/files/safe-fs.ts` (wrapper implementation)
- `src/files/path.ts` (runtime lstat + path utilities)

To check locally:

```bash
npm run check:plugin-fs
```

The release build runs this guard and will abort if a raw import is introduced.

## Rust-side FS confinement

Rust commands mirror the TypeScript path sanitizer via `src-tauri/src/security/fs_policy.rs`.
Handlers resolve paths against `$APPDATA` or `$APPDATA/attachments`, reject
traversal, UNC, cross-volume changes, and deny symlinks. Errors surface to the
UI as short `{ code, message }` pairs; see `security/error_map.rs`.
For allowed roots and more background, see `docs/security/fs-allowlist.md`.
