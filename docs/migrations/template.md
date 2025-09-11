# Migration Template

## Numbering

Migrations use a zero-padded counter shared by each pair:

- `NNNN_label.up.sql`
- `NNNN_label.down.sql`

Files should contain only the statements required for the migration. The runner
automatically wraps execution in a transaction and enables foreign keys, so do
not include `BEGIN`, `COMMIT`, or `PRAGMA foreign_keys` statements inside the
SQL files.

Use the `.up.sql` file for forward changes and `.down.sql` for the exact
inverse.
