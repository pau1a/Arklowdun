# Member attachments (PR9)

Attachments provide per-member document storage starting in PR1 (schema) and PR9 (UI). This document defines storage rules, IPC expectations, UI behaviour, and security constraints.

## Table summary
See [schema_changes.md](schema_changes.md#member_attachments-table) for DDL. Each row maps a vault file to a member.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | TEXT primary key | UUIDv4 generated in Rust. |
| `household_id` | TEXT NOT NULL | Must match the owning member's household. |
| `member_id` | TEXT NOT NULL | References `family_members.id`. |
| `title` | TEXT | Optional user-friendly name. |
| `root_key` | TEXT NOT NULL | Vault root identifier. |
| `relative_path` | TEXT NOT NULL | Path inside the vault root. |
| `mime_hint` | TEXT | Optional MIME type hint. |
| `added_at` | INTEGER NOT NULL | Epoch ms when attachment created. |

Unique index `(household_id, root_key, relative_path)` prevents duplicate registrations of the same file.

## IPC operations
Detailed in [ipc_extensions.md](ipc_extensions.md#new-commands).
- Add: Validates the path via the vault service. Rejects symlinks and paths outside the root. On success, logs INFO with `attachment_id`.
- Remove: Deletes the row; does **not** delete the underlying file. Vault cleanup remains manual to avoid data loss.
- List: Returns attachments sorted by `added_at DESC`.

## UI experience
- Located in `tabs/Documents.tsx` within the member drawer (PR9).
- Drag-and-drop target accepts files; on drop, the renderer invokes `member_attachments_add` with `root_key` resolved from vault configuration and `relative_path` computed via Tauri API.
- Each attachment card shows title (fallback to filename), added timestamp, and action buttons:
  - **Open**: Launches the file with the OS default handler via existing vault API.
  - **Reveal**: Opens Finder at the file location (macOS beta scope).
  - **Remove**: Calls `member_attachments_remove` and updates the store.
- Errors show toast messages based on error codes:
  - `ATTACHMENTS/OUT_OF_VAULT`: "File must live inside the vault."
  - `ATTACHMENTS/SYMLINK_REJECTED`: "Symbolic links are not supported."
  - `ATTACHMENTS/PATH_CONFLICT`: "This file is already attached." (includes reference to existing attachment in toast detail).

## Logging
- Renderer emits `ui.family.attach.add`/`ui.family.attach.remove` logs per [logging_policy.md](logging_policy.md).
- Backend logs include redacted `relative_path` (filename only) and `root_key`. Full absolute paths are never logged.

## Security considerations
- Vault service must confirm the provided `root_key` belongs to the current user session before registering the attachment.
- Attachments follow household membership: when a member is deleted, cascade removal ensures no orphan attachments remain.
- Export routines (PR12) include attachment metadata but not file blobs; see [diagnostics_and_export.md](diagnostics_and_export.md).

## Future enhancements (out of scope)
- Encrypting attachment metadata.
- Automatic duplicate detection based on file hash.
- Background sync when attachments change outside the app.
