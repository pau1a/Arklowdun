CREATE TABLE "events" (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
, end_at INTEGER, tz TEXT, start_at_utc INTEGER, end_at_utc INTEGER, rrule TEXT, exdates TEXT);
CREATE INDEX events_household_end_at_utc_idx ON events(household_id, end_at_utc);
CREATE INDEX events_household_start_at_utc_idx ON events(household_id, start_at_utc);
CREATE INDEX events_household_updated_idx ON events(household_id, updated_at);
CREATE INDEX idx_events_household_active ON events(household_id, updated_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_events_household_rrule ON events(household_id, rrule);
CREATE INDEX idx_events_household_title ON events(household_id, title);
