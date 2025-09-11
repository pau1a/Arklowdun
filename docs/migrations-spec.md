# Migrations Specification

This document outlines conventions for SQL migrations used by the project.

## Naming
- Migrations live in the `migrations/` directory.
- File names use the form `YYYYMMDDhhmm_label.sql`.
  - `YYYYMMDDhhmm` is the UTC timestamp when the migration was created.
  - `label` is a short, snake_case description.
- Apply migrations in lexicographic order. The timestamp ensures correct ordering.
- Once committed, migration files are **immutable**. Create a new migration to change prior work.

## Tracking Table
The application maintains a table to track applied migrations:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  checksum TEXT NOT NULL
);
```

- `version` is the full filename, e.g. `202509012006_household.sql`.
- `applied_at` records the Unix epoch time when a migration ran.
- `checksum` is a SHA-256 digest of the normalized SQL actually executed.

## Checksums
- When applying a migration the application normalizes the SQL (drops comments and blank lines) and computes its SHA-256 checksum.
- If an entry already exists in `schema_migrations` with a different checksum, migration stops with an error.
- New migrations insert their checksum alongside the version in the same transaction.

## Ordering & Transactions
- Execute migrations sequentially in ascending filename order.
- Each migration runs inside a single transaction and must be idempotent.


## Reversibility
- Migrations must be safe to run multiple times and should leave the schema unchanged when re-executed.
- Every migration is wrapped in a transaction so partial changes are rolled back if an error occurs.
- When rebuilding tables, drop any temporary tables with `DROP TABLE IF EXISTS` before creation so reruns succeed.

## Versioning & Recovery
- Applied migrations are recorded in `schema_migrations`.
- On startup the application compares this table with migrations on disk and applies any new versions.
- If a crash occurs during a migration, SQLite rolls back the transaction and the next launch re-runs the migration.
- To force a rebuild from scratch, remove the database file; the app will recreate it and reapply all migrations.
