DROP INDEX IF EXISTS events_household_start_at_utc_idx;
DROP INDEX IF EXISTS events_household_datetime_idx;
CREATE TABLE events_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
INSERT INTO events_new (id, title, starts_at, reminder, household_id, created_at, updated_at, deleted_at)
  SELECT id, title, start_at, reminder, household_id, created_at, updated_at, deleted_at FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX IF NOT EXISTS events_household_updated_idx ON events(household_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_events_household_active ON events(household_id, updated_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS events_household_start_idx ON events(household_id, starts_at);
