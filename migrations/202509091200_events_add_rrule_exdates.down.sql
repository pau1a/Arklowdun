DROP INDEX IF EXISTS idx_events_household_rrule;
CREATE TABLE events_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER,
  tz TEXT,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  start_at_utc INTEGER,
  end_at_utc INTEGER
);
INSERT INTO events_new (id, title, start_at, end_at, tz, household_id, created_at, updated_at, deleted_at, start_at_utc, end_at_utc)
  SELECT id, title, start_at, end_at, tz, household_id, created_at, updated_at, deleted_at, start_at_utc, end_at_utc FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX IF NOT EXISTS events_household_updated_idx ON events(household_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_events_household_active ON events(household_id, updated_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS events_household_start_idx ON events(household_id, start_at);
CREATE INDEX IF NOT EXISTS events_household_start_at_utc_idx ON events(household_id, start_at_utc);
