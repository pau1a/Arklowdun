-- id: 202509021301_fk_integrity_check
-- checksum: e18bd8bb3096ad8aec6287ad09f2b19144a8c02e3e49c6e5cffdbac6fc1c7964
-- Verify no foreign key violations remain after rebuilding tables

BEGIN;
PRAGMA foreign_key_check;
COMMIT;
