-- id: 202509041200_vehicles_rework

BEGIN;

ALTER TABLE vehicles ADD COLUMN make TEXT;
ALTER TABLE vehicles ADD COLUMN model TEXT;
ALTER TABLE vehicles ADD COLUMN reg TEXT;
ALTER TABLE vehicles ADD COLUMN vin TEXT;
ALTER TABLE vehicles ADD COLUMN next_mot_due INTEGER;
ALTER TABLE vehicles ADD COLUMN next_service_due INTEGER;

DROP INDEX IF EXISTS vehicles_household_updated_idx;
CREATE INDEX IF NOT EXISTS idx_vehicles_household_updated
  ON vehicles(household_id, updated_at);

COMMIT;
