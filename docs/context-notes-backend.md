# Contextual Notes Backend

This PR introduces the `note_links` table and supporting IPC so that sticky notes
can be attached to calendar events or indexed files. The goal is to guarantee
household scoping, consistent pagination, and typed bindings for later frontend
work.

## Table definition

```sql
CREATE TABLE note_links (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  note_id      TEXT NOT NULL REFERENCES notes(id)     ON DELETE CASCADE ON UPDATE CASCADE,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('event','file')),
  entity_id    TEXT NOT NULL,
  relation     TEXT NOT NULL DEFAULT 'attached_to',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
```

Supporting indexes:

- `note_links_unique(household_id, note_id, entity_type, entity_id)` prevents
  duplicate links.
- `note_links_context_idx(household_id, entity_type, entity_id)` accelerates
  lookups for a specific entity.
- `note_links_note_idx(household_id, note_id)` enables reverse lookups from a
  note to its contextual attachments.

Timestamps use milliseconds since the Unix epoch, matching the rest of the
schema.

## Household invariants

All mutations call `ensure_same_household`, which verifies:

1. The note exists, is active (`deleted_at IS NULL`), and belongs to the
   requested household.
2. The target entity (event series or indexed file) exists in the same
   household. Deleted events are treated as missing.

Cross-household attempts surface `NOTE_LINK/CROSS_HOUSEHOLD`. Missing notes or
entities surface `NOTE_LINK/ENTITY_NOT_FOUND`.

## IPC commands

All commands run through the DB write guard and validate the `household_id`
argument with `repo::require_household` before executing.

### `note_links_create`

* **Input**: `household_id`, `note_id`, `entity_type` (`"event" | "file"`),
  `entity_id`, optional `relation` (`default: "attached_to"`).
* **Returns**: the persisted `NoteLink` row.
* **Errors**:
  - `NOTE_LINK/CROSS_HOUSEHOLD`
  - `NOTE_LINK/ENTITY_NOT_FOUND`
  - `NOTE_LINK/ALREADY_EXISTS`

### `note_links_delete`

* **Input**: `household_id`, `link_id`.
* **Returns**: nothing on success.
* **Errors**:
  - `NOTE_LINK/ENTITY_NOT_FOUND` when no row matches the household + id pair.

### `notes_list_for_entity`

* **Input**: `household_id`, `entity_type`, `entity_id`, optional
  `category_ids` filter, optional cursor, optional limit (default 20, capped at
  100).
* **Returns**: `ContextNotesPage { notes, next_cursor? }` ordered by
  `created_at, id`.
* **Cursor format**: base64-encoded `"{created_at}:{note_id}"`, matching the
  existing notes cursor introduced in migration 0002. Passing an empty or `None`
  cursor returns the first page.

### `notes_quick_create_for_entity`

* **Input**: `household_id`, `entity_type`, `entity_id`, `category_id`, `text`,
  optional `color` (defaults to `#FFF4B8`).
* **Behaviour**: creates a note with the next `position`/`z` in the household
  and links it to the entity inside a single transaction. Any failure rolls back
  both inserts, ensuring no orphaned links.
* **Returns**: the newly created `Note`.
* **Errors**: the same household/entity checks as `note_links_create`, plus
  standard validation errors from the underlying insert (for example foreign-key
  violations on `category_id`).

## Error codes

| Code                          | Description                                   |
|-------------------------------|-----------------------------------------------|
| `NOTE_LINK/CROSS_HOUSEHOLD`   | Note or entity belongs to a different family. |
| `NOTE_LINK/ENTITY_NOT_FOUND`  | Note, event, or file could not be located.    |
| `NOTE_LINK/ALREADY_EXISTS`    | Duplicate contextual link attempted.          |

## Logging

Repository helpers (`create_link`, `delete_link`, `quick_create_note_for_entity`)
emit `tracing::debug!` entries targeted at `contextual-notes` with the action,
note id, entity type/id, and household. These records aid local debugging and
are not forwarded to telemetry.

