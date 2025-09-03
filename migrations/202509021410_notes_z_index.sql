-- id: 202509021410_notes_z_index
-- checksum: 37d22b4c1529ebabe3953b2202862effdbd2e13a829f0c337b0adeec71ae2f5a

BEGIN;

ALTER TABLE notes ADD COLUMN z INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS notes_scope_z_idx ON notes(household_id, deleted_at, z, position);

COMMIT;
