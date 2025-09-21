-- Deterministic fixture used by the CI guardrail. The events below are curated
-- to produce zero drift so the guard should pass when this SQL is loaded.
PRAGMA journal_mode = WAL;
BEGIN;
DROP TABLE IF EXISTS events;
CREATE TABLE events (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL,
  title         TEXT NOT NULL,
  tz            TEXT,
  start_at_utc  INTEGER NOT NULL,
  end_at_utc    INTEGER,
  deleted_at    INTEGER
);

INSERT INTO events (id, household_id, title, tz, start_at_utc, end_at_utc, deleted_at) VALUES
  ('timed_utc', 'hh_clean_1', 'UTC morning sync', 'UTC', 1711962000000, 1711965600000, NULL),
  ('timed_paris', 'hh_clean_1', 'Paris stand-up', 'Europe/Paris', 1711954800000, 1711960200000, NULL),
  ('timed_tokyo', 'hh_clean_2', 'Tokyo planning', 'Asia/Tokyo', 1712034000000, 1712037600000, NULL),
  ('allday_ny', 'hh_clean_3', 'NY all-day coverage', 'America/New_York', 1710046800000, 1710129600000, NULL),
  ('allday_la', 'hh_clean_4', 'LA maintenance window', 'America/Los_Angeles', 1714546800000, 1714633200000, NULL),
  ('timed_open', 'hh_clean_5', 'Open ended support shift', 'UTC', 1717243200000, NULL, NULL);

COMMIT;
