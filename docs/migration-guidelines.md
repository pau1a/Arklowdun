# Migration Guidelines

## Purpose & Scope
- This document defines how contributors design, implement, and test database migrations.
- It covers both schema changes (tables, columns, indexes, constraints) and limited data backfills.
- For naming and numbering conventions, see [migrations-spec.md](migrations-spec.md).

## Core Principles
- **Idempotency**: migrations should be safe to rerun; use `IF NOT EXISTS` where available.
- **Reversibility**: every `.up.sql` must have a matching `.down.sql` that restores the prior state.
- **Atomicity**: migrations run inside a transaction; design with all-or-nothing semantics in mind.
- **Immutability**: once merged, existing migrations are never edited. Create a new migration instead.
- **Minimal Scope**: keep each migration focused on one logical change.

## Safe Schema Alterations
### Adding a column
```sql
-- up
ALTER TABLE pets ADD COLUMN nickname TEXT NOT NULL DEFAULT '';

-- down: SQLite requires a rebuild to drop a column
CREATE TABLE pets_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
    -- other columns...
);
INSERT INTO pets_new (id, name /* ... */)
    SELECT id, name /* ... */ FROM pets;
DROP TABLE pets;
ALTER TABLE pets_new RENAME TO pets;
```

### Dropping a column or loosening a constraint
```sql
-- up: remove NOT NULL constraint via rebuild
CREATE TABLE bills_new (
    id TEXT PRIMARY KEY,
    amount INTEGER,
    -- ...
);
INSERT INTO bills_new SELECT * FROM bills;
DROP TABLE bills;
ALTER TABLE bills_new RENAME TO bills;

-- down: restore NOT NULL
CREATE TABLE bills_new (
    id TEXT PRIMARY KEY,
    amount INTEGER NOT NULL,
    -- ...
);
INSERT INTO bills_new SELECT * FROM bills;
DROP TABLE bills;
ALTER TABLE bills_new RENAME TO bills;
```

### Foreign keys
```sql
-- up
ALTER TABLE vehicles
    ADD COLUMN household_id TEXT NOT NULL
    REFERENCES household(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- down
CREATE TABLE vehicles_new (
    id TEXT PRIMARY KEY,
    -- other columns without household_id...
);
INSERT INTO vehicles_new (id /* ... */)
    SELECT id /* ... */ FROM vehicles;
DROP TABLE vehicles;
ALTER TABLE vehicles_new RENAME TO vehicles;
```

### Indexes and triggers
```sql
-- up
CREATE INDEX IF NOT EXISTS bills_household_idx
    ON bills(household_id);

-- down
DROP INDEX IF EXISTS bills_household_idx;
```

## Data Migrations
- Small backfills may live in `.up.sql` with explicit values and sanity checks.
- For large or batch updates, document the batching strategy or move the work into application-level tooling.
- Avoid heavy transforms inside schema migrations without explicit review.

## Rollback Guidance
- `.down.sql` must restore the previous state using rebuild-table patterns when necessary.
- If rollback is lossy, add a header comment explaining the limitation and rationale.
- Ensure each `.down.sql` file can run on its own without context beyond the paired `.up.sql`.

## Testing & Verification
- Check numbering and pairing: `./scripts/check_migrations.sh`.
- Round-trip: apply all ups, apply all downs, then apply ups again via `./scripts/migrate.sh roundtrip`.
- Integrity check: `sqlite3 dev.sqlite "PRAGMA integrity_check;"`.
- Optional: snapshot schemas and compare diffs after round-trip.

### Canonical schema
After applying migrations, ensure the canonical schema file matches your database:

```sh
npm run schema:verify
```

If the database is missing, run your migrations first.

If `schema.sql` is missing or you changed DDL, refresh the file:

```sh
npm run schema:update
```

For a clean-room check that builds a temporary database (used in CI):

```sh
npm run schema:ci
```

## Large Migration Strategies
- Break long-running migrations into smaller steps.
- Use feature flags or phased rollout when table locks could impact production.
- Plan downtime if blocking operations are unavoidable.

## Cross-Engine Notes
- SQLite is the baseline. Other engines may have different locking or `ALTER TABLE` semantics.
- When porting to another engine, document engine-specific caveats.

## Commenting Standards
Each migration file begins with:
```sql
-- Author: <name or GitHub handle>
-- Date: YYYY-MM-DD
-- Purpose: one-line description
-- Rollback: note limitations if not perfect
```

## Failure & Recovery
- Although the runner wraps migrations in transactions, a crash can still leave partial state.
- Consult the troubleshooting guide for manual cleanup procedures.

## Contributor Workflow Summary
1. Generate files: `./scripts/new_migration.sh "label"`.
2. Edit `.up.sql` and `.down.sql` using safe patterns.
3. Add the header comment block.
4. Run `./scripts/check_migrations.sh` and round-trip tests locally.
5. Commit both files together.

## Linkage
- Referenced from [README](../README.md) under "Database integrity".
- Referenced from [CONTRIBUTING](../CONTRIBUTING.md) after migration workflow.
- Complements [migrations-spec.md](migrations-spec.md) and [integrity-rules.md](integrity-rules.md).
