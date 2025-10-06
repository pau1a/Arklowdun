CREATE TABLE files_index_tmp AS
  SELECT id,
         household_id,
         file_id,
         filename,
         updated_at_utc,
         ordinal,
         score_hint
    FROM files_index;

DROP TABLE files_index;

CREATE TABLE files_index (
  id INTEGER PRIMARY KEY,
  household_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  score_hint INTEGER NOT NULL DEFAULT 0,
  UNIQUE (household_id, file_id),
  FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO files_index (id, household_id, file_id, filename, updated_at_utc, ordinal, score_hint)
  SELECT id, household_id, file_id, filename, updated_at_utc, ordinal, score_hint
    FROM files_index_tmp;

DROP TABLE files_index_tmp;

DROP INDEX IF EXISTS files_index_household_cat_filename;
