DROP INDEX IF EXISTS notes_scope_z_idx;
CREATE TABLE notes_new (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT 0,
  deleted_at   INTEGER
);
INSERT INTO notes_new (id, household_id, position, created_at, updated_at, deleted_at)
  SELECT id, household_id, position, created_at, updated_at, deleted_at FROM notes;
DROP TABLE notes;
ALTER TABLE notes_new RENAME TO notes;
CREATE INDEX IF NOT EXISTS notes_scope_idx ON notes(household_id, deleted_at, position);
CREATE UNIQUE INDEX IF NOT EXISTS notes_household_position_idx ON notes(household_id, position) WHERE deleted_at IS NULL;
