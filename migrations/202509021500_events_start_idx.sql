-- id: 202509021500_events_start_idx
-- checksum: 5bda89bb4cb0709ae2621a2840489db358b67df60d1e2a0a5e99ff9f4a9d60b1
-- rename datetime to starts_at and add index on (household_id, starts_at)
BEGIN;
ALTER TABLE events RENAME COLUMN datetime TO starts_at;
DROP INDEX IF EXISTS events_household_datetime_idx;
CREATE INDEX IF NOT EXISTS events_household_start_idx ON events(household_id, starts_at);
COMMIT;
