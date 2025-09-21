-- Preconditions enforced by the Rust migrator before executing this file:
-- 1) No NULL start_at_utc values remain.
-- 2) Rows with legacy end_at must also have end_at_utc populated.

DROP INDEX IF EXISTS events_household_start_idx;

CREATE TABLE events_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  tz TEXT,
  start_at_utc INTEGER NOT NULL,
  end_at_utc INTEGER,
  rrule TEXT,
  exdates TEXT
);

INSERT INTO events_new (
  id,
  title,
  reminder,
  household_id,
  created_at,
  updated_at,
  deleted_at,
  tz,
  start_at_utc,
  end_at_utc,
  rrule,
  exdates
)
SELECT
  id,
  title,
  reminder,
  household_id,
  created_at,
  updated_at,
  deleted_at,
  tz,
  start_at_utc,
  end_at_utc,
  rrule,
  exdates
FROM events;

DROP TABLE events;

ALTER TABLE events_new RENAME TO events;

CREATE INDEX IF NOT EXISTS events_household_updated_idx ON events(household_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_events_household_active ON events(household_id, updated_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS events_household_start_at_utc_idx ON events(household_id, start_at_utc);
CREATE INDEX IF NOT EXISTS events_household_end_at_utc_idx ON events(household_id, end_at_utc);
CREATE INDEX IF NOT EXISTS idx_events_household_rrule ON events(household_id, rrule);
CREATE INDEX IF NOT EXISTS idx_events_household_title ON events(household_id, title);
