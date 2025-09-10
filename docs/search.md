# Search semantics

Arklowdun's search covers **Events** and **Notes**. Files are included only when the
optional `files_index` table exists in the database.

Queries are case-insensitive: all SQL `LIKE` and equality checks use
`COLLATE NOCASE`, and exact matches score higher than partial matches.
Results are ordered deterministically by `score` (DESC), timestamp (DESC)
and insertion ordinal (ASC).

Queries shorter than two characters are ignored on the backend and frontend.
One-character queries are ignored **except** prefix filename searches when a
`files_index` table is present. Developers can override the front-end rule with
`VITE_SEARCH_MINLEN`.

## Troubleshooting

- Seeing no results for Vehicles or Pets? Those entities are not part of the
  search scope yet.
- Files missing? Ensure the `files_index` table is present; otherwise only
  Events and Notes are searched.
