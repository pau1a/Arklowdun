-- id: 202509041200_vehicles_rework
-- checksum: 507cffbf1cfd6427a00e0d4c31d3d68fb58b72d60c6811f23ec1c732e7758e13

BEGIN;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS make TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS reg TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vin TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS next_mot_due INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS next_service_due INTEGER;


DROP INDEX IF EXISTS vehicles_household_updated_idx;
CREATE INDEX IF NOT EXISTS idx_vehicles_household_updated
  ON vehicles(household_id, updated_at);

COMMIT;
