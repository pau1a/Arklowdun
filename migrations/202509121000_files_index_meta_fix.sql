-- id: 202509121000_files_index_meta_fix
BEGIN;

-- Add columns only if they don't exist (idempotent).
-- SQLite: adding NOT NULL requires a DEFAULT; we drop the DEFAULT immediately after backfill.

-- source_max_updated_utc
SELECT 1
FROM pragma_table_info('files_index_meta')
WHERE name = 'source_max_updated_utc';
-- if not found, add it
ALTER TABLE files_index_meta ADD COLUMN source_max_updated_utc TEXT DEFAULT '1970-01-01T00:00:00Z';

-- version
SELECT 1
FROM pragma_table_info('files_index_meta')
WHERE name = 'version';
-- if not found, add it
ALTER TABLE files_index_meta ADD COLUMN version INTEGER DEFAULT 0;

-- Backfill sensible values (only for rows where they were NULL from the ALTER).
UPDATE files_index_meta
SET
  source_max_updated_utc = COALESCE(source_max_updated_utc, '1970-01-01T00:00:00Z'),
  version = COALESCE(version, 0);

COMMIT;
