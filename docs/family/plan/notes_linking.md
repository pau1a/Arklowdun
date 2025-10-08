# Notes linking (PR10)

Linking notes to family members enables person-specific narratives without losing household-wide notes. This document clarifies how the `notes.member_id` column behaves and how the renderer consumes it.

## Column behaviour
- Added in PR1 via `ALTER TABLE notes ADD COLUMN member_id TEXT NULL;` (see [schema_changes.md](schema_changes.md#notes-table-alteration)).
- Nullable to support existing household/general notes. `NULL` means the note applies to the household.
- No foreign key constraint in SQLite to avoid table rebuild. Application logic ensures referential integrity.

## Repository rules (PR2)
- When creating or updating a note via existing commands, `member_id` may be set to a valid `family_members.id` or `null`.
- `notes.list` returns all notes. Renderer filters to `member_id` when showing person-scoped notes.
- On member deletion (soft or hard), repository helpers set `member_id = NULL` for affected notes before removing or archiving the member. This prevents dangling references and ensures household visibility remains.

## UI behaviour (PR10)
- Notes tab lists only notes where `member_id` matches the active member. Provide a toggle to "Show household notes" which includes `NULL` entries for reference.
- Creating a note within the tab sets `member_id` automatically.
- Deleting a member moves their notes to household scope by setting `member_id = NULL` and appending "(Former member: <name>)" to the note body. This behaviour is implemented in the backend repo to ensure consistency regardless of UI path.

## Search and filters
- Global notes search (outside Family) remains unchanged. Person-linked notes still appear in global listings but display a "Linked to <member>" badge.
- Export routines (PR12) include `member_id` associations so support teams can trace note provenance.

## Testing
- Backend test: deleting a member with linked notes retains the notes and sets `member_id` to `NULL`.
- Renderer test: toggling the "Show household notes" control swaps between member-only and combined views.

## Future considerations
- Introduce hard foreign keys when SQLite version update allows table rebuild without downtime.
- Support linking a note to multiple members (requires join table, not planned here).
