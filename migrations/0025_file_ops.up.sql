CREATE TABLE IF NOT EXISTS missing_attachments (
  household_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  detected_at_utc INTEGER NOT NULL,
  repaired_at_utc INTEGER,
  action TEXT,
  new_category TEXT,
  new_relative_path TEXT,
  PRIMARY KEY (household_id, table_name, row_id)
);

CREATE INDEX IF NOT EXISTS missing_attachments_hh
  ON missing_attachments (household_id, table_name);
