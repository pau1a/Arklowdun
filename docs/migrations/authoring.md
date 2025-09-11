# Authoring Migrations

Migrations must be reversible. For every `*.up.sql` there is a matching
`*.down.sql` that restores the prior schema. Migration files contain only the
statements for the change; the runner wraps them in a transaction and enables
foreign keys automatically, so omit any `BEGIN`, `COMMIT`, or `PRAGMA` lines.
Avoid queries that return rows (e.g., `PRAGMA foreign_key_check`); run such checks in the runner.

## Numbering

Migration files use a gapless, zero-padded counter shared by each pair:

```
NNNN_label.up.sql
NNNN_label.down.sql
```

Numbers start at `0001` and increase by one for each subsequent migration. Run `scripts/check_migrations.sh` before committing to verify numbering and pairing.

## Common Patterns

### Create table
- **Up:** `CREATE TABLE ...;`
- **Down:** `DROP TABLE IF EXISTS ...;`

### Add column
SQLite lacks `DROP COLUMN`; rebuild the table:
```
CREATE TABLE new_t (/* original cols */);
INSERT INTO new_t (...) SELECT ... FROM t;
DROP TABLE t;
ALTER TABLE new_t RENAME TO t;
```
Re-create indexes, triggers and foreign keys.

### Add NOT NULL with DEFAULT
Rebuild the table and backfill the column explicitly to avoid inserting NULLs:

```
CREATE TABLE t_new (
  id INTEGER PRIMARY KEY,
  existing TEXT,
  new_col TEXT NOT NULL DEFAULT 'x'
);
INSERT INTO t_new (id, existing, new_col)
  SELECT id, existing, 'x' FROM t;
DROP TABLE t;
ALTER TABLE t_new RENAME TO t;
```
The down migration rebuilds the table without `new_col`.

### Rename column
Rebuild the table and alias the renamed column when copying:

```
CREATE TABLE t_new (id INTEGER PRIMARY KEY, old_name TEXT);
INSERT INTO t_new SELECT id, new_name AS old_name FROM t;
DROP TABLE t;
ALTER TABLE t_new RENAME TO t;
```

### Tighten constraint
To tighten a constraint, rebuild the table with the new definition and copy the
data explicitly. The downgrade should rebuild back to the relaxed schema.

### Indexes / Triggers
- **Up:** `CREATE INDEX ...;`
- **Down:** `DROP INDEX IF EXISTS ...;`

Avoid non invertible data transforms. If a transform cannot be reversed, reconsider the migration.

The version key stored in `schema_migrations` uses the full filename including
the `.up.sql` suffix.
