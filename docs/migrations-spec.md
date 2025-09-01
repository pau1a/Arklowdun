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
CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  checksum TEXT NOT NULL
);
```

- `id` is the filename without the `.sql` suffix.
- `applied_at` records the Unix epoch time when a migration ran.
- `checksum` is a SHA-256 digest of the migration file after normalizing its contents.

## Checksums
- Before applying a migration, compute its SHA-256 checksum using `npm run migrate:checksum -- <file>`.
- Normalize files before hashing:
  - Strip any UTF-8 byte order mark (BOM).
  - Convert CRLF sequences to `\n`.
  - Trim trailing whitespace from each line.
  - Ensure the file ends with a single trailing `\n`.
  These steps keep checksums stable across editors and platforms.
- Store the checksum in the `migrations` table. On startup, verify stored checksums against the files to detect accidental edits.

## Ordering & Transactions
- Execute migrations sequentially in ascending filename order.
- Each migration runs inside a single transaction and must be idempotent.

