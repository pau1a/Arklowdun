# Integrity Rules for Migrations

This document captures conventions for enforcing data integrity in our SQLite schema. Apply these constraints whenever tables or columns are introduced in a migration.

## UNIQUE

Use `UNIQUE` constraints (or unique indexes) to prevent duplicate natural keys. Favor partial unique indexes that ignore soft-deleted rows.

```sql
-- Example: each file path is unique per household
CREATE UNIQUE INDEX IF NOT EXISTS bills_household_file_idx
  ON bills(household_id, root_key, relative_path)
  WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
```

Apply similar indexes for other tables storing `root_key`/`relative_path` pairs.

## CHECK

`CHECK` constraints ensure values stay within expected bounds or enumerations.

```sql
ALTER TABLE bills
  ADD CONSTRAINT bills_amount_non_negative CHECK (amount >= 0);

ALTER TABLE pets
  ADD CONSTRAINT pets_type_check CHECK (type IN ('dog','cat','fish'));
```

Use these for non-negative amounts, bounded dates, or limited sets of strings.

## ON DELETE CASCADE

Use `ON DELETE CASCADE` on foreign keys where child rows should disappear automatically when the parent is removed.

```sql
-- Cascade when the parent household or vehicle is deleted
household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
vehicle_id   TEXT NOT NULL REFERENCES vehicles(id)   ON DELETE CASCADE
```

This prevents orphaned rows and keeps cleanup simple.

## Migration

The first migration to apply these rules will be:

```
migrations/202509021200_add_integrity_constraints.sql
```

Future schema changes should conform to the guidance above.
