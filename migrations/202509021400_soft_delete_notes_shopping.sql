-- id: 202509021400_soft_delete_notes_shopping
-- checksum: 4992776ddfbe2526b45bf413af02d31cc4f457af8f5ad33f95a7c60aaa9d9f39

BEGIN;

-- Ensure tables exist with the full, current schema.
CREATE TABLE IF NOT EXISTS notes (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT 0,
  deleted_at   INTEGER
);

CREATE TABLE IF NOT EXISTS shopping_items (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT 0,
  deleted_at   INTEGER
);

-- Live views expose only non-deleted rows
CREATE VIEW IF NOT EXISTS notes_live AS
  SELECT * FROM notes WHERE deleted_at IS NULL;

CREATE VIEW IF NOT EXISTS shopping_live AS
  SELECT * FROM shopping_items WHERE deleted_at IS NULL;

-- Scope + ordering indexes
CREATE INDEX IF NOT EXISTS notes_scope_idx
  ON notes(household_id, deleted_at, position);

CREATE UNIQUE INDEX IF NOT EXISTS notes_household_position_idx
  ON notes(household_id, position)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS shopping_scope_idx
  ON shopping_items(household_id, deleted_at, position);

CREATE UNIQUE INDEX IF NOT EXISTS shopping_household_position_idx
  ON shopping_items(household_id, position)
  WHERE deleted_at IS NULL;

COMMIT;
