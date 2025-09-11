DROP INDEX IF EXISTS bills_household_file_idx;
DROP INDEX IF EXISTS policies_household_file_idx;
DROP INDEX IF EXISTS property_documents_household_file_idx;
DROP INDEX IF EXISTS inventory_items_household_file_idx;
DROP INDEX IF EXISTS vehicle_maintenance_household_file_idx;
DROP INDEX IF EXISTS pet_medical_household_file_idx;

CREATE TABLE bills_new (
  id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  due_date INTEGER NOT NULL,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO bills_new (id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, position)
  SELECT id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, position FROM bills;
DROP TABLE bills;
ALTER TABLE bills_new RENAME TO bills;
CREATE INDEX IF NOT EXISTS bills_household_updated_idx ON bills(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS bills_household_position_idx ON bills(household_id, position) WHERE deleted_at IS NULL;

CREATE TABLE policies_new (
  id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  due_date INTEGER NOT NULL,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO policies_new (id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, position)
  SELECT id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, position FROM policies;
DROP TABLE policies;
ALTER TABLE policies_new RENAME TO policies;
CREATE INDEX IF NOT EXISTS policies_household_updated_idx ON policies(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS policies_household_position_idx ON policies(household_id, position) WHERE deleted_at IS NULL;

CREATE TABLE property_documents_new (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  renewal_date INTEGER NOT NULL,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO property_documents_new (id, description, renewal_date, document, reminder, household_id, created_at, updated_at, deleted_at, position)
  SELECT id, description, renewal_date, document, reminder, household_id, created_at, updated_at, deleted_at, position FROM property_documents;
DROP TABLE property_documents;
ALTER TABLE property_documents_new RENAME TO property_documents;
CREATE INDEX IF NOT EXISTS property_documents_household_updated_idx ON property_documents(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS property_documents_household_position_idx ON property_documents(household_id, position) WHERE deleted_at IS NULL;

CREATE TABLE inventory_items_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purchase_date INTEGER,
  warranty_expiry INTEGER,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO inventory_items_new (id, name, purchase_date, warranty_expiry, document, reminder, household_id, created_at, updated_at, deleted_at, position)
  SELECT id, name, purchase_date, warranty_expiry, document, reminder, household_id, created_at, updated_at, deleted_at, position FROM inventory_items;
DROP TABLE inventory_items;
ALTER TABLE inventory_items_new RENAME TO inventory_items;
CREATE INDEX IF NOT EXISTS inventory_items_household_updated_idx ON inventory_items(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_household_position_idx ON inventory_items(household_id, position) WHERE deleted_at IS NULL;

CREATE TABLE vehicle_maintenance_new (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  date INTEGER NOT NULL,
  type TEXT NOT NULL,
  cost INTEGER,
  document TEXT,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
INSERT INTO vehicle_maintenance_new (id, vehicle_id, date, type, cost, document, household_id, created_at, updated_at, deleted_at)
  SELECT id, vehicle_id, date, type, cost, document, household_id, created_at, updated_at, deleted_at FROM vehicle_maintenance;
DROP TABLE vehicle_maintenance;
ALTER TABLE vehicle_maintenance_new RENAME TO vehicle_maintenance;
CREATE INDEX IF NOT EXISTS vehicle_maintenance_household_updated_idx ON vehicle_maintenance(household_id, updated_at);
CREATE INDEX IF NOT EXISTS vehicle_maintenance_vehicle_date_idx ON vehicle_maintenance(vehicle_id, date);

CREATE TABLE pet_medical_new (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  date INTEGER NOT NULL,
  description TEXT NOT NULL,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
INSERT INTO pet_medical_new (id, pet_id, date, description, document, reminder, household_id, created_at, updated_at, deleted_at)
  SELECT id, pet_id, date, description, document, reminder, household_id, created_at, updated_at, deleted_at FROM pet_medical;
DROP TABLE pet_medical;
ALTER TABLE pet_medical_new RENAME TO pet_medical;
CREATE INDEX IF NOT EXISTS pet_medical_household_updated_idx ON pet_medical(household_id, updated_at);
CREATE INDEX IF NOT EXISTS pet_medical_pet_date_idx ON pet_medical(pet_id, date);
