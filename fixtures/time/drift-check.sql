PRAGMA journal_mode=WAL;
BEGIN;

-- Minimal schema used by the drift checker
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL,
  title         TEXT NOT NULL,
  start_at      INTEGER NOT NULL,   -- ms since epoch (local wall-clock)
  end_at        INTEGER,            -- ms since epoch (local wall-clock)
  tz            TEXT,               -- IANA tz or NULL
  start_at_utc  INTEGER,            -- ms since epoch (UTC)
  end_at_utc    INTEGER,            -- ms since epoch (UTC)
  deleted_at    INTEGER
);

-- 1) INTENTIONAL DRIFT: timed event 1h mismatch (should be flagged: timed_mismatch)
INSERT INTO events (
  id, household_id, title, tz, start_at, end_at, start_at_utc, end_at_utc, deleted_at
)
VALUES (
  'timed_drift', 'hh1', 'Timed Drift', 'UTC',
  strftime('%s','2024-03-10 09:00:00')*1000,
  strftime('%s','2024-03-10 10:00:00')*1000,
  -- UTC fields intentionally set to one hour earlier → local recompute = 08:00
  strftime('%s','2024-03-10 08:00:00')*1000,
  strftime('%s','2024-03-10 09:00:00')*1000,
  NULL
);

-- 2) CLEAN timed event (should NOT be flagged)
INSERT INTO events (
  id, household_id, title, tz, start_at, end_at, start_at_utc, end_at_utc, deleted_at
)
VALUES (
  'timed_ok', 'hh1', 'Timed OK', 'UTC',
  strftime('%s','2024-04-01 12:00:00')*1000,
  strftime('%s','2024-04-01 13:00:00')*1000,
  strftime('%s','2024-04-01 12:00:00')*1000,
  strftime('%s','2024-04-01 13:00:00')*1000,
  NULL
);

-- 3) ALL-DAY across DST that should be accepted (no drift)
-- America/New_York all-day: stored local midnight-to-midnight.
-- UTC values chosen so that recompute lands on local midnight boundaries.
INSERT INTO events (
  id, household_id, title, tz, start_at, end_at, start_at_utc, end_at_utc, deleted_at
)
VALUES (
  'allday_ok', 'hh2', 'All-day OK', 'America/New_York',
  strftime('%s','2024-03-10 00:00:00')*1000,
  strftime('%s','2024-03-11 00:00:00')*1000,
  -- Approximate correct UTC midnights for this span (boundary-aligned => allowed)
  strftime('%s','2024-03-10 05:00:00')*1000,  -- midnight local ≈ 05:00Z
  strftime('%s','2024-03-11 04:00:00')*1000,  -- next midnight local ≈ 04:00Z (after DST jump)
  NULL
);

-- 4) ALL-DAY with bad boundaries (should be flagged: allday_boundary_error)
INSERT INTO events (
  id, household_id, title, tz, start_at, end_at, start_at_utc, end_at_utc, deleted_at
)
VALUES (
  'allday_bad', 'hh3', 'All-day Bad', 'America/New_York',
  strftime('%s','2024-03-10 00:00:00')*1000,
  strftime('%s','2024-03-11 00:00:00')*1000,
  -- Push UTC two days off so recompute won't land on ±1 day local midnights
  strftime('%s','2024-03-08 05:00:00')*1000,
  strftime('%s','2024-03-09 05:00:00')*1000,
  NULL
);

-- 5) Missing timezone (should be flagged: tz_missing)
INSERT INTO events (
  id, household_id, title, tz, start_at, end_at, start_at_utc, end_at_utc, deleted_at
)
VALUES (
  'missing_tz', 'hh4', 'Missing TZ', NULL,
  strftime('%s','2024-04-01 12:00:00')*1000,
  NULL,
  strftime('%s','2024-04-01 12:00:00')*1000,
  NULL,
  NULL
);

COMMIT;
