# Migrations Specification

This project uses paired SQL migration files to evolve the schema.

## Naming
- Migrations live in the `migrations/` directory.
- Each migration consists of two files:
  - `NNNN_label.up.sql`
  - `NNNN_label.down.sql`
- `NNNN` is a zero-padded, gapless 4-digit number incremented for each migration.
- `label` is a short, snake_case description.

## Content
- Do **not** include `BEGIN`, `COMMIT`, or `PRAGMA` statements; the migration runner manages transactions and foreign-key enforcement.
- The `.up.sql` file contains forward-only changes.
- The `.down.sql` file contains the exact inverse and should use rebuild-table patterns when dropping columns or loosening constraints.
- Always name indexes, triggers, and foreign keys explicitly, and specify `ON DELETE`/`ON UPDATE` actions where relevant.

## Workflow
1. Generate files from the template:
   ```sh
   ./scripts/new_migration.sh "add widgets table"
   ```
2. Edit the generated `up` and `down` files.
3. Verify numbering and pairing:
   ```sh
   ./scripts/check_migrations.sh
   ```
4. Commit both files together.

The runner records applied versions in `schema_migrations` and executes files in ascending filename order.
