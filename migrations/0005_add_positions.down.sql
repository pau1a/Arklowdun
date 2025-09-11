DROP INDEX IF EXISTS bills_household_position_idx;
DROP INDEX IF EXISTS policies_household_position_idx;
DROP INDEX IF EXISTS property_documents_household_position_idx;
DROP INDEX IF EXISTS inventory_items_household_position_idx;
DROP INDEX IF EXISTS vehicles_household_position_idx;
DROP INDEX IF EXISTS pets_household_position_idx;
DROP INDEX IF EXISTS family_members_household_position_idx;
DROP INDEX IF EXISTS budget_categories_household_position_idx;

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
  root_key TEXT,
  relative_path TEXT
);
INSERT INTO bills_new (id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path)
  SELECT id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path FROM bills;
DROP TABLE bills;
ALTER TABLE bills_new RENAME TO bills;
CREATE INDEX IF NOT EXISTS bills_household_updated_idx ON bills(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS bills_household_file_idx ON bills(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

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
  root_key TEXT,
  relative_path TEXT
);
INSERT INTO policies_new (id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path)
  SELECT id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path FROM policies;
DROP TABLE policies;
ALTER TABLE policies_new RENAME TO policies;
CREATE INDEX IF NOT EXISTS policies_household_updated_idx ON policies(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS policies_household_file_idx ON policies(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

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
  root_key TEXT,
  relative_path TEXT
);
INSERT INTO property_documents_new (id, description, renewal_date, document, reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path)
  SELECT id, description, renewal_date, document, reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path FROM property_documents;
DROP TABLE property_documents;
ALTER TABLE property_documents_new RENAME TO property_documents;
CREATE INDEX IF NOT EXISTS property_documents_household_updated_idx ON property_documents(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS property_documents_household_file_idx ON property_documents(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

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
  root_key TEXT,
  relative_path TEXT
);
INSERT INTO inventory_items_new (id, name, purchase_date, warranty_expiry, document, reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path)
  SELECT id, name, purchase_date, warranty_expiry, document, reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path FROM inventory_items;
DROP TABLE inventory_items;
ALTER TABLE inventory_items_new RENAME TO inventory_items;
CREATE INDEX IF NOT EXISTS inventory_items_household_updated_idx ON inventory_items(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_household_file_idx ON inventory_items(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

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
  root_key TEXT,
  relative_path TEXT,
  next_mot_due INTEGER,
  next_service_due INTEGER
);
INSERT INTO vehicles_new (id, name, mot_date, service_date, mot_reminder, service_reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path, next_mot_due, next_service_due)
  SELECT id, name, mot_date, service_date, mot_reminder, service_reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path, next_mot_due, next_service_due FROM vehicles;
DROP TABLE vehicles;
ALTER TABLE vehicles_new RENAME TO vehicles;
CREATE INDEX IF NOT EXISTS idx_vehicles_household_updated ON vehicles(household_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_household_file_idx ON vehicles(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

CREATE TABLE pets_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
INSERT INTO pets_new (id, name, type, household_id, created_at, updated_at, deleted_at)
  SELECT id, name, type, household_id, created_at, updated_at, deleted_at FROM pets;
DROP TABLE pets;
ALTER TABLE pets_new RENAME TO pets;
CREATE INDEX IF NOT EXISTS pets_household_updated_idx ON pets(household_id, updated_at);

CREATE TABLE family_members_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birthday INTEGER,
  notes TEXT,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
INSERT INTO family_members_new (id, name, birthday, notes, household_id, created_at, updated_at, deleted_at)
  SELECT id, name, birthday, notes, household_id, created_at, updated_at, deleted_at FROM family_members;
DROP TABLE family_members;
ALTER TABLE family_members_new RENAME TO family_members;
CREATE INDEX IF NOT EXISTS family_members_household_updated_idx ON family_members(household_id, updated_at);

CREATE TABLE budget_categories_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_budget INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
INSERT INTO budget_categories_new (id, name, monthly_budget, household_id, created_at, updated_at, deleted_at)
  SELECT id, name, monthly_budget, household_id, created_at, updated_at, deleted_at FROM budget_categories;
DROP TABLE budget_categories;
ALTER TABLE budget_categories_new RENAME TO budget_categories;
CREATE INDEX IF NOT EXISTS budget_categories_household_updated_idx ON budget_categories(household_id, updated_at);

