DROP INDEX IF EXISTS idx_events_household_active;

CREATE TABLE household_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);
INSERT INTO household_new (id, name, created_at, updated_at)
  SELECT id, name, created_at, updated_at FROM household;
DROP TABLE household;
ALTER TABLE household_new RENAME TO household;

CREATE TABLE events_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  datetime INTEGER NOT NULL,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO events_new (id, title, datetime, reminder, household_id, created_at, updated_at)
  SELECT id, title, datetime, reminder, household_id, created_at, updated_at FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX IF NOT EXISTS events_household_updated_idx ON events(household_id, updated_at);

CREATE TABLE bills_new (
  id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  due_date INTEGER NOT NULL,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO bills_new (id, amount, due_date, document, reminder, household_id, created_at, updated_at)
  SELECT id, amount, due_date, document, reminder, household_id, created_at, updated_at FROM bills;
DROP TABLE bills;
ALTER TABLE bills_new RENAME TO bills;
CREATE INDEX IF NOT EXISTS bills_household_updated_idx ON bills(household_id, updated_at);

CREATE TABLE policies_new (
  id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  due_date INTEGER NOT NULL,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO policies_new (id, amount, due_date, document, reminder, household_id, created_at, updated_at)
  SELECT id, amount, due_date, document, reminder, household_id, created_at, updated_at FROM policies;
DROP TABLE policies;
ALTER TABLE policies_new RENAME TO policies;
CREATE INDEX IF NOT EXISTS policies_household_updated_idx ON policies(household_id, updated_at);

CREATE TABLE property_documents_new (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  renewal_date INTEGER NOT NULL,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO property_documents_new (id, description, renewal_date, document, reminder, household_id, created_at, updated_at)
  SELECT id, description, renewal_date, document, reminder, household_id, created_at, updated_at FROM property_documents;
DROP TABLE property_documents;
ALTER TABLE property_documents_new RENAME TO property_documents;
CREATE INDEX IF NOT EXISTS property_documents_household_updated_idx ON property_documents(household_id, updated_at);

CREATE TABLE inventory_items_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purchase_date INTEGER,
  warranty_expiry INTEGER,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO inventory_items_new (id, name, purchase_date, warranty_expiry, document, reminder, household_id, created_at, updated_at)
  SELECT id, name, purchase_date, warranty_expiry, document, reminder, household_id, created_at, updated_at FROM inventory_items;
DROP TABLE inventory_items;
ALTER TABLE inventory_items_new RENAME TO inventory_items;
CREATE INDEX IF NOT EXISTS inventory_items_household_updated_idx ON inventory_items(household_id, updated_at);

CREATE TABLE vehicles_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mot_date INTEGER,
  service_date INTEGER,
  mot_reminder INTEGER,
  service_reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO vehicles_new (id, name, mot_date, service_date, mot_reminder, service_reminder, household_id, created_at, updated_at)
  SELECT id, name, mot_date, service_date, mot_reminder, service_reminder, household_id, created_at, updated_at FROM vehicles;
DROP TABLE vehicles;
ALTER TABLE vehicles_new RENAME TO vehicles;
CREATE INDEX IF NOT EXISTS vehicles_household_updated_idx ON vehicles(household_id, updated_at);

CREATE TABLE vehicle_maintenance_new (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  date INTEGER NOT NULL,
  type TEXT NOT NULL,
  cost INTEGER,
  document TEXT,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO vehicle_maintenance_new (id, vehicle_id, date, type, cost, document, household_id, created_at, updated_at)
  SELECT id, vehicle_id, date, type, cost, document, household_id, created_at, updated_at FROM vehicle_maintenance;
DROP TABLE vehicle_maintenance;
ALTER TABLE vehicle_maintenance_new RENAME TO vehicle_maintenance;
CREATE INDEX IF NOT EXISTS vehicle_maintenance_household_updated_idx ON vehicle_maintenance(household_id, updated_at);
CREATE INDEX IF NOT EXISTS vehicle_maintenance_vehicle_date_idx ON vehicle_maintenance(vehicle_id, date);

CREATE TABLE pets_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO pets_new (id, name, type, household_id, created_at, updated_at)
  SELECT id, name, type, household_id, created_at, updated_at FROM pets;
DROP TABLE pets;
ALTER TABLE pets_new RENAME TO pets;
CREATE INDEX IF NOT EXISTS pets_household_updated_idx ON pets(household_id, updated_at);

CREATE TABLE pet_medical_new (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  date INTEGER NOT NULL,
  description TEXT NOT NULL,
  document TEXT,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO pet_medical_new (id, pet_id, date, description, document, reminder, household_id, created_at, updated_at)
  SELECT id, pet_id, date, description, document, reminder, household_id, created_at, updated_at FROM pet_medical;
DROP TABLE pet_medical;
ALTER TABLE pet_medical_new RENAME TO pet_medical;
CREATE INDEX IF NOT EXISTS pet_medical_household_updated_idx ON pet_medical(household_id, updated_at);

CREATE TABLE family_members_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birthday INTEGER,
  notes TEXT,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO family_members_new (id, name, birthday, notes, household_id, created_at, updated_at)
  SELECT id, name, birthday, notes, household_id, created_at, updated_at FROM family_members;
DROP TABLE family_members;
ALTER TABLE family_members_new RENAME TO family_members;
CREATE INDEX IF NOT EXISTS family_members_household_updated_idx ON family_members(household_id, updated_at);

CREATE TABLE budget_categories_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_budget INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO budget_categories_new (id, name, monthly_budget, household_id, created_at, updated_at)
  SELECT id, name, monthly_budget, household_id, created_at, updated_at FROM budget_categories;
DROP TABLE budget_categories;
ALTER TABLE budget_categories_new RENAME TO budget_categories;
CREATE INDEX IF NOT EXISTS budget_categories_household_updated_idx ON budget_categories(household_id, updated_at);

CREATE TABLE expenses_new (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES budget_categories(id),
  amount INTEGER NOT NULL,
  date INTEGER NOT NULL,
  description TEXT,
  household_id TEXT NOT NULL REFERENCES household(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO expenses_new (id, category_id, amount, date, description, household_id, created_at, updated_at)
  SELECT id, category_id, amount, date, description, household_id, created_at, updated_at FROM expenses;
DROP TABLE expenses;
ALTER TABLE expenses_new RENAME TO expenses;
CREATE INDEX IF NOT EXISTS expenses_household_updated_idx ON expenses(household_id, updated_at);

