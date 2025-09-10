-- id: 202509111200_files_index
-- checksum: 40348c9c1e9a644b3a98e2e2e30b938ca38ec5b2b1ba935632fad7b8e17261f1

BEGIN;

CREATE TABLE IF NOT EXISTS files_index (
  id INTEGER PRIMARY KEY,
  household_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  score_hint INTEGER NOT NULL DEFAULT 0,
  UNIQUE(household_id, file_id)
);

-- Covering index for case-insensitive prefix lookups and ordering helpers
CREATE INDEX IF NOT EXISTS idx_files_index_household_filename_cov
  ON files_index(household_id, filename COLLATE NOCASE, updated_at_utc, ordinal);

CREATE INDEX IF NOT EXISTS idx_files_index_household_updated_ordinal
  ON files_index(household_id, updated_at_utc DESC, ordinal ASC);

CREATE TABLE IF NOT EXISTS files_index_meta (
  household_id TEXT PRIMARY KEY,
  last_built_at_utc TEXT NOT NULL,
  source_row_count INTEGER NOT NULL,
  source_max_updated_utc TEXT NOT NULL,
  version INTEGER NOT NULL
);

COMMIT;
