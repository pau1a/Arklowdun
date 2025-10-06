ALTER TABLE files_index
  ADD COLUMN category TEXT NOT NULL DEFAULT 'misc';

ALTER TABLE files_index
  ADD COLUMN size_bytes INTEGER;

ALTER TABLE files_index
  ADD COLUMN mime TEXT;

ALTER TABLE files_index
  ADD COLUMN modified_at_utc BIGINT;

ALTER TABLE files_index
  ADD COLUMN sha256 TEXT NULL;

UPDATE files_index
   SET size_bytes = COALESCE(size_bytes, 0),
       mime = NULL,
       modified_at_utc = NULL;

CREATE UNIQUE INDEX IF NOT EXISTS files_index_household_cat_filename
  ON files_index(household_id, category, filename);
