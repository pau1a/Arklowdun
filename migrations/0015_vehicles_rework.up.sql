-- id: 202509041200_vehicles_rework
-- checksum: 2f9396c2aab6fd5b62ca18d14f2a2d715a7b93ffdf83e95b1a5520ca206ecba8


ALTER TABLE vehicles ADD COLUMN make TEXT;
ALTER TABLE vehicles ADD COLUMN model TEXT;
ALTER TABLE vehicles ADD COLUMN reg TEXT;
ALTER TABLE vehicles ADD COLUMN vin TEXT;
ALTER TABLE vehicles ADD COLUMN next_mot_due INTEGER;
ALTER TABLE vehicles ADD COLUMN next_service_due INTEGER;

DROP INDEX IF EXISTS vehicles_household_updated_idx;
CREATE INDEX IF NOT EXISTS idx_vehicles_household_updated
  ON vehicles(household_id, updated_at);

