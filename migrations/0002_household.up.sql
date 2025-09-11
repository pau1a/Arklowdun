-- id: 202509012006_household
-- checksum: f3ffbea1851b41d44abb4a364f099ed1d1eb57c786c6aadda95f5cd5e75a2eb4


CREATE TABLE IF NOT EXISTS household (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);

-- Example domain table with household reference
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  datetime INTEGER NOT NULL,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS events_household_updated_idx
  ON events(household_id, updated_at);

