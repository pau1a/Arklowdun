-- Drop the FKs by rebuilding without them.

CREATE TABLE files_index_old (
  id INTEGER PRIMARY KEY,
  household_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  score_hint INTEGER NOT NULL DEFAULT 0,
  UNIQUE (household_id, file_id)
);

INSERT INTO files_index_old
SELECT id, household_id, file_id, filename, updated_at_utc, ordinal, score_hint
FROM files_index;

DROP TABLE files_index;
ALTER TABLE files_index_old RENAME TO files_index;

CREATE TABLE files_index_meta_old (
  household_id TEXT PRIMARY KEY,
  last_built_at_utc TEXT NOT NULL,
  source_row_count INTEGER NOT NULL,
  source_max_updated_utc TEXT NOT NULL,
  version INTEGER NOT NULL
);

INSERT INTO files_index_meta_old
SELECT household_id, last_built_at_utc, source_row_count, source_max_updated_utc, version
FROM files_index_meta;

DROP TABLE files_index_meta;
ALTER TABLE files_index_meta_old RENAME TO files_index_meta;
