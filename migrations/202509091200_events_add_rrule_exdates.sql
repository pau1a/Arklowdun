BEGIN;
ALTER TABLE events ADD COLUMN rrule TEXT;
ALTER TABLE events ADD COLUMN exdates TEXT;
CREATE INDEX IF NOT EXISTS idx_events_household_rrule ON events(household_id, rrule);
COMMIT;
