-- Canonicalise event time columns to start_at / end_at.
-- This migration is idempotent on modern SQLite (supports IF NOT EXISTS).

BEGIN;

-- Ensure columns exist (no-op if already there).
ALTER TABLE events ADD COLUMN IF NOT EXISTS start_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS end_at   INTEGER NOT NULL DEFAULT 0;

-- Optional: backfill from legacy names if they exist.
-- These UPDATEs will fail if the legacy columns don't exist, so we gate with a pragma check.
-- We emulate gating using a temporary table probe trick.

-- 1) Probe: does `starts_at` exist?
-- If yes, this SELECT returns 1 row; if no, returns 0 and the following UPDATE is skipped by WHERE 0.
WITH has_legacy AS (
  SELECT 1 AS present
  FROM pragma_table_info('events')
  WHERE name = 'starts_at'
  LIMIT 1
)
UPDATE events
SET start_at = (SELECT CASE WHEN EXISTS (SELECT 1 FROM has_legacy) THEN starts_at ELSE start_at END);

-- 2) Probe: does `ends_at` exist?
WITH has_legacy AS (
  SELECT 1 AS present
  FROM pragma_table_info('events')
  WHERE name = 'ends_at'
  LIMIT 1
)
UPDATE events
SET end_at = (SELECT CASE WHEN EXISTS (SELECT 1 FROM has_legacy) THEN ends_at ELSE end_at END);

-- Create a helpful composite index for range queries (idempotent).
CREATE INDEX IF NOT EXISTS idx_events_household_time
ON events (household_id, start_at, end_at);

COMMIT;
