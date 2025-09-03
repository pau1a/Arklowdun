-- id: 202509021300_explicit_fk_actions
-- checksum: 0c83377e5b462c21c8d57c01a20d175f650ccc3d268264048246f133b54291c0
-- Rebuild tables to ensure every foreign key declares explicit ON DELETE and ON UPDATE actions.

PRAGMA foreign_keys=OFF;
BEGIN;

-- events: cascade household changes to dependent events
CREATE TABLE events_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  datetime INTEGER NOT NULL,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
INSERT INTO events_new SELECT id, title, datetime, reminder, household_id, created_at, updated_at, deleted_at FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX IF NOT EXISTS events_household_updated_idx ON events(household_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_events_household_active ON events(household_id, updated_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS events_household_datetime_idx ON events(household_id, datetime);

-- bills: cascade household changes to bills
CREATE TABLE bills_new (
  id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  due_date INTEGER NOT NULL,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  root_key TEXT,
  relative_path TEXT
);
INSERT INTO bills_new SELECT id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, position, root_key, relative_path FROM bills;
DROP TABLE bills;
ALTER TABLE bills_new RENAME TO bills;
CREATE INDEX IF NOT EXISTS bills_household_updated_idx ON bills(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS bills_household_position_idx ON bills(household_id, position) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bills_household_file_idx ON bills(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

-- policies: cascade household changes to policies
CREATE TABLE policies_new (
  id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  due_date INTEGER NOT NULL,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  root_key TEXT,
  relative_path TEXT
);
INSERT INTO policies_new SELECT id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, position, root_key, relative_path FROM policies;
DROP TABLE policies;
ALTER TABLE policies_new RENAME TO policies;
CREATE INDEX IF NOT EXISTS policies_household_updated_idx ON policies(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS policies_household_position_idx ON policies(household_id, position) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS policies_household_file_idx ON policies(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

-- property_documents: cascade household changes to property documents
CREATE TABLE property_documents_new (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  renewal_date INTEGER NOT NULL,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  root_key TEXT,
  relative_path TEXT
);
INSERT INTO property_documents_new SELECT id, description, renewal_date, document, reminder, household_id, created_at, updated_at, deleted_at, position, root_key, relative_path FROM property_documents;
DROP TABLE property_documents;
ALTER TABLE property_documents_new RENAME TO property_documents;
CREATE INDEX IF NOT EXISTS property_documents_household_updated_idx ON property_documents(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS property_documents_household_position_idx ON property_documents(household_id, position) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS property_documents_household_file_idx ON property_documents(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

-- inventory_items: cascade household changes to inventory items
CREATE TABLE inventory_items_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purchase_date INTEGER,
  warranty_expiry INTEGER,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  root_key TEXT,
  relative_path TEXT
);
INSERT INTO inventory_items_new SELECT id, name, purchase_date, warranty_expiry, document, reminder, household_id, created_at, updated_at, deleted_at, position, root_key, relative_path FROM inventory_items;
DROP TABLE inventory_items;
ALTER TABLE inventory_items_new RENAME TO inventory_items;
CREATE INDEX IF NOT EXISTS inventory_items_household_updated_idx ON inventory_items(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_household_position_idx ON inventory_items(household_id, position) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_household_file_idx ON inventory_items(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

-- vehicles: cascade household changes to vehicles
CREATE TABLE vehicles_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mot_date INTEGER,
  service_date INTEGER,
  mot_reminder INTEGER,
  service_reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO vehicles_new SELECT id, name, mot_date, service_date, mot_reminder, service_reminder, household_id, created_at, updated_at, deleted_at, position FROM vehicles;
DROP TABLE vehicles;
ALTER TABLE vehicles_new RENAME TO vehicles;
CREATE INDEX IF NOT EXISTS vehicles_household_updated_idx ON vehicles(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_household_position_idx ON vehicles(household_id, position) WHERE deleted_at IS NULL;

-- vehicle_maintenance: cascade vehicle and household changes to maintenance records
CREATE TABLE vehicle_maintenance_new (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  date INTEGER NOT NULL,
  type TEXT NOT NULL,
  cost INTEGER,
  document TEXT,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  root_key TEXT,
  relative_path TEXT
);
INSERT INTO vehicle_maintenance_new SELECT id, vehicle_id, date, type, cost, document, household_id, created_at, updated_at, deleted_at, root_key, relative_path FROM vehicle_maintenance;
DROP TABLE vehicle_maintenance;
ALTER TABLE vehicle_maintenance_new RENAME TO vehicle_maintenance;
CREATE INDEX IF NOT EXISTS vehicle_maintenance_household_updated_idx ON vehicle_maintenance(household_id, updated_at);
CREATE INDEX IF NOT EXISTS vehicle_maintenance_vehicle_date_idx ON vehicle_maintenance(vehicle_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_maintenance_household_file_idx ON vehicle_maintenance(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

-- pets: cascade household changes to pets
CREATE TABLE pets_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO pets_new SELECT id, name, type, household_id, created_at, updated_at, deleted_at, position FROM pets;
DROP TABLE pets;
ALTER TABLE pets_new RENAME TO pets;
CREATE INDEX IF NOT EXISTS pets_household_updated_idx ON pets(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS pets_household_position_idx ON pets(household_id, position) WHERE deleted_at IS NULL;

-- pet_medical: cascade pet and household changes to medical records
CREATE TABLE pet_medical_new (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE ON UPDATE CASCADE,
  date INTEGER NOT NULL,
  description TEXT NOT NULL,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  root_key TEXT,
  relative_path TEXT
);
INSERT INTO pet_medical_new SELECT id, pet_id, date, description, document, reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path FROM pet_medical;
DROP TABLE pet_medical;
ALTER TABLE pet_medical_new RENAME TO pet_medical;
CREATE INDEX IF NOT EXISTS pet_medical_household_updated_idx ON pet_medical(household_id, updated_at);
CREATE INDEX IF NOT EXISTS pet_medical_pet_date_idx ON pet_medical(pet_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS pet_medical_household_file_idx ON pet_medical(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

-- family_members: cascade household changes to family members
CREATE TABLE family_members_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birthday INTEGER,
  notes TEXT,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO family_members_new SELECT id, name, birthday, notes, household_id, created_at, updated_at, deleted_at, position FROM family_members;
DROP TABLE family_members;
ALTER TABLE family_members_new RENAME TO family_members;
CREATE INDEX IF NOT EXISTS family_members_household_updated_idx ON family_members(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS family_members_household_position_idx ON family_members(household_id, position) WHERE deleted_at IS NULL;

-- budget_categories: cascade household changes to categories
CREATE TABLE budget_categories_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_budget INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO budget_categories_new SELECT id, name, monthly_budget, household_id, created_at, updated_at, deleted_at, position FROM budget_categories;
DROP TABLE budget_categories;
ALTER TABLE budget_categories_new RENAME TO budget_categories;
CREATE INDEX IF NOT EXISTS budget_categories_household_updated_idx ON budget_categories(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS budget_categories_household_position_idx ON budget_categories(household_id, position) WHERE deleted_at IS NULL;

-- expenses: cascade category and household changes to expenses
CREATE TABLE expenses_new (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE ON UPDATE CASCADE,
  amount INTEGER NOT NULL,
  date INTEGER NOT NULL,
  description TEXT,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
INSERT INTO expenses_new SELECT id, category_id, amount, date, description, household_id, created_at, updated_at, deleted_at FROM expenses;
DROP TABLE expenses;
ALTER TABLE expenses_new RENAME TO expenses;
CREATE INDEX IF NOT EXISTS expenses_household_updated_idx ON expenses(household_id, updated_at);
CREATE INDEX IF NOT EXISTS expenses_category_date_idx ON expenses(category_id, date);

COMMIT;

PRAGMA foreign_keys=ON;
