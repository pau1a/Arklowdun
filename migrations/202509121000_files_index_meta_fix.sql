-- id: 202509121000_files_index_meta_fix
BEGIN;

-- Add columns with defaults; the runner skips these ALTERs if the columns exist.
ALTER TABLE files_index_meta ADD COLUMN source_max_updated_utc TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z';
ALTER TABLE files_index_meta ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- Backfill sensible values in case rows predate the ALTER.
UPDATE files_index_meta
SET
  source_max_updated_utc = COALESCE(source_max_updated_utc, '1970-01-01T00:00:00Z'),
  version = COALESCE(version, 0);

COMMIT;
