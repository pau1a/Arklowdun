# Safe filesystem wrapper

All TypeScript code must import filesystem operations from `src/files/safe-fs.ts`.
This wrapper enforces canonicalization and the v1 symlink-deny policy before
accessing disk. Direct imports of `@tauri-apps/plugin-fs` will be blocked in a
future pull request. The wrapper also re-exports `RootKey` and `PathError` for
convenience.
