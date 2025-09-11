DROP INDEX IF EXISTS idx_vehicles_household_updated;
CREATE TABLE vehicles_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mot_date INTEGER,
  service_date INTEGER,
  mot_reminder INTEGER,
  service_reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO vehicles_new (id, name, mot_date, service_date, mot_reminder, service_reminder, household_id, created_at, updated_at, deleted_at, position)
  SELECT id, name, mot_date, service_date, mot_reminder, service_reminder, household_id, created_at, updated_at, deleted_at, position FROM vehicles;
DROP TABLE vehicles;
ALTER TABLE vehicles_new RENAME TO vehicles;
CREATE INDEX IF NOT EXISTS vehicles_household_updated_idx ON vehicles(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_household_position_idx ON vehicles(household_id, position) WHERE deleted_at IS NULL;
