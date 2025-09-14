-- Add FKs on household_id → household(id) for files_index and files_index_meta.
-- No BEGIN/COMMIT here — the runner wraps each migration in a transaction.

-- 1) Remove orphans before enforcing FK
DELETE FROM files_index
WHERE household_id NOT IN (SELECT id FROM household);

DELETE FROM files_index_meta
WHERE household_id NOT IN (SELECT id FROM household);

-- 2) Rebuild files_index with FK
CREATE TABLE files_index_new (
  id INTEGER PRIMARY KEY,
  household_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  score_hint INTEGER NOT NULL DEFAULT 0,
  UNIQUE (household_id, file_id),
  FOREIGN KEY (household_id) REFERENCES household(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

INSERT INTO files_index_new
SELECT id, household_id, file_id, filename, updated_at_utc, ordinal, score_hint
FROM files_index;

DROP TABLE files_index;
ALTER TABLE files_index_new RENAME TO files_index;

-- 3) Rebuild files_index_meta with FK
CREATE TABLE files_index_meta_new (
  household_id TEXT PRIMARY KEY,
  last_built_at_utc TEXT NOT NULL,
  source_row_count INTEGER NOT NULL,
  source_max_updated_utc TEXT NOT NULL,
  version INTEGER NOT NULL,
  FOREIGN KEY (household_id) REFERENCES household(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

INSERT INTO files_index_meta_new
SELECT household_id, last_built_at_utc, source_row_count, source_max_updated_utc, version
FROM files_index_meta;

DROP TABLE files_index_meta;
ALTER TABLE files_index_meta_new RENAME TO files_index_meta;
