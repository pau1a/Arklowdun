-- id: 202509021410_notes_z_index
-- checksum: 4c79b39e4e183abd644cf2008d71eb15d2698bcb35a12c10ea275d970c391c56

BEGIN;

ALTER TABLE notes ADD COLUMN z INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS notes_scope_z_idx ON notes(household_id, deleted_at, z, position);

COMMIT;
