-- id: 202509041200_vehicles_rework
-- checksum: 507cffbf1cfd6427a00e0d4c31d3d68fb58b72d60c6811f23ec1c732e7758e13

BEGIN;

ALTER TABLE vehicles ADD COLUMN make TEXT;
ALTER TABLE vehicles ADD COLUMN model TEXT;
ALTER TABLE vehicles ADD COLUMN reg TEXT;
ALTER TABLE vehicles ADD COLUMN vin TEXT;
ALTER TABLE vehicles ADD COLUMN next_mot_due INTEGER;
ALTER TABLE vehicles ADD COLUMN next_service_due INTEGER;

-- Optional: backfill new next_* fields from legacy columns if present.
UPDATE vehicles SET next_mot_due     = mot_date     WHERE next_mot_due     IS NULL;
UPDATE vehicles SET next_service_due = service_date WHERE next_service_due IS NULL;

DROP INDEX IF EXISTS vehicles_household_updated_idx;
CREATE INDEX IF NOT EXISTS idx_vehicles_household_updated
  ON vehicles(household_id, updated_at);

COMMIT;
