-- id: 202509021410_notes_z_index

BEGIN;

ALTER TABLE notes ADD COLUMN z INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS notes_scope_z_idx ON notes(household_id, deleted_at, z, position);

COMMIT;
