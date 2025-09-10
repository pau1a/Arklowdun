# Search semantics

Arklowdun's search covers **Events**, **Notes**, **Vehicles** (make/model/reg/nickname)
and **Pets** (name/species). Files are included only when the optional
`files_index` table exists in the database. The permanent sidebar search box has
been removed in favour of a modal command palette.

Queries are case-insensitive: all SQL `LIKE` and equality checks use
`COLLATE NOCASE`, and exact matches score higher than partial matches.
Results are ordered deterministically by `score` (DESC), timestamp (DESC)
and insertion ordinal (ASC).

Vehicle registration and nickname fields are coalesced across possible
column names (`reg`, `registration`, `plate`, `nickname`, `name`); no
schema migration is required in this PR.

Queries shorter than two characters are ignored on the backend and frontend.
One-character queries are ignored **except** prefix filename searches when a
`files_index` table is present. Developers can override the front-end rule with
`VITE_SEARCH_MINLEN`.

## Command Palette

- Open with ⌘K on macOS or Ctrl+K on Windows/Linux, or click the magnifying glass
  in the sidebar.
- Palette appears as a centered modal dialog (`role="dialog"`) with a search
  input using `role="combobox"`; results render in a `role="listbox"`.
- Items accept `{ kind, title, subtitle, action }` to allow future commands
  beyond search. Results are shown in backend order without client-side sorting.
- Arrow keys navigate results; Enter activates; Esc or backdrop closes and
  focus returns to the main application.
- The shortcut is ignored when focus is inside an input, textarea, or other
  editable region.
- Active options scroll smoothly unless the user prefers reduced motion.

## Engine Hygiene

- A 30 s in-memory micro-cache serves duplicate searches keyed by `{q, offset, limit, householdId}` (includes a version field; bump `CACHE_VERSION` to invalidate keys after semantic changes).
  - Entries expire after 30 s.
  - Explicit busts on `householdChanged` or `searchInvalidated` events.
- Capability checks live in `src/shared/capabilities.ts`; features like `files_index` are gated by these probes. Never sort results on the client—preserve backend order.

## Troubleshooting

- Files missing? Ensure the `files_index` table is present; otherwise Events,
  Notes, Vehicles and Pets are searched.
