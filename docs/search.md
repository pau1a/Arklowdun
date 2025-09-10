# Search semantics

Arklowdun's search covers **Events**, **Notes**, **Vehicles** (make/model/reg/nickname)
and **Pets** (name/species). Files are included only when the optional
`files_index` table exists in the database.

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

## Troubleshooting

- Files missing? Ensure the `files_index` table is present; otherwise Events,
  Notes, Vehicles and Pets are searched.
