BEGIN;
DROP INDEX IF EXISTS events_household_datetime_idx;
CREATE INDEX IF NOT EXISTS events_household_start_at_utc_idx ON events(household_id, start_at_utc);
COMMIT;
