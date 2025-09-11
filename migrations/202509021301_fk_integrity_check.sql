-- id: 202509021301_fk_integrity_check
-- Verify no foreign key violations remain after rebuilding tables

BEGIN;
PRAGMA foreign_key_check;
COMMIT;
