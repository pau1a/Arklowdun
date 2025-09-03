-- id: 202509021400_soft_delete_notes_shopping
-- checksum: 80bd1dce04aa54b8033c48c8d7e8f8aece8837d94862ddf673397a05883f8e28
BEGIN;

-- notes
ALTER TABLE notes ADD COLUMN deleted_at INTEGER;
ALTER TABLE notes ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
CREATE VIEW IF NOT EXISTS notes_live AS
  SELECT * FROM notes WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_scope_idx
  ON notes(household_id, deleted_at, position);
CREATE UNIQUE INDEX IF NOT EXISTS notes_household_position_idx
  ON notes(household_id, position)
  WHERE deleted_at IS NULL;

-- shopping_items
ALTER TABLE shopping_items ADD COLUMN deleted_at INTEGER;
ALTER TABLE shopping_items ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
CREATE VIEW IF NOT EXISTS shopping_live AS
  SELECT * FROM shopping_items WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS shopping_scope_idx
  ON shopping_items(household_id, deleted_at, position);
CREATE UNIQUE INDEX IF NOT EXISTS shopping_household_position_idx
  ON shopping_items(household_id, position)
  WHERE deleted_at IS NULL;

COMMIT;
