# File system allowlist

The Tauri file system plugin denies all paths by default. Only the directories listed below are readable and writable.

## Allowed paths

| Path | Rationale |
| ---- | --------- |
| `$APPDATA/**` | App-owned data directory for the database, settings, and logs needed for core functionality. |
| `$APPDATA/attachments/**` | Staging area for imported attachments; confines uploads to a dedicated subdirectory. |

User-selected library roots are intentionally not allowlisted yet. Runtime extension or a UI flow to manage additional roots will be evaluated in a later PR.

## OS paths

Examples of the resolved `$APPDATA` base:

| Platform | Example |
| -------- | ------- |
| macOS | `/Users/alice/Library/Application Support/Arklowdun` |
| Linux | `/home/alice/.local/share/arklowdun` |
| Windows | `C:\\Users\\Alice\\AppData\\Roaming\\Arklowdun` |

## Proposing new paths

1. Justify why the existing paths are insufficient and document the intended data.
2. Choose the narrowest absolute path possible; avoid broad wildcards.
3. Update `src-tauri/tauri.conf.json5` with a commented entry and mirror it in this document.
4. Verify that paths outside the allowlist are denied at runtime.


## Path sanitizer

All UI file operations pass through a canonicalizer that resolves user input to an absolute path within an allowlisted root.

- Separators are normalized and `.` segments collapsed.
- `..` traversal, UNC paths, and cross-volume drive changes are rejected.
- Only `$APPDATA` and `$APPDATA/attachments` are valid bases.
- All symlinks are denied in v1 (may relax once real path resolution is available).
- Path joins use `@tauri-apps/api/path.join` at runtime for cross-platform correctness.

### Manual verification

1. Attempt to open `../../etc/passwd` → denied.
2. Try a UNC path like `\\server\share` → denied.
3. Symlink inside `attachments` pointing outside → denied.
4. Regular file within `attachments` → allowed.
