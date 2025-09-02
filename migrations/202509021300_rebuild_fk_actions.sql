-- id: 202509021300_rebuild_fk_actions
-- checksum: f4ea247ee462bafd4c0691635e70d75a65800451dfe0e76f476f964e54a35104
-- Rebuild tables to enforce ON DELETE/ON UPDATE actions

PRAGMA foreign_keys=OFF;
BEGIN;

-- events table
CREATE TABLE events_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  datetime INTEGER NOT NULL,
  reminder INTEGER,
  -- Cascade household deletions/updates to events
  household_id TEXT NOT NULL REFERENCES household(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
INSERT INTO events_new (id, title, datetime, reminder, household_id, created_at, updated_at, deleted_at)
  SELECT id, title, datetime, reminder, household_id, created_at, updated_at, NULL AS deleted_at FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX events_household_updated_idx ON events(household_id, updated_at);
CREATE INDEX IF NOT EXISTS events_household_datetime_idx ON events(household_id, datetime);
CREATE INDEX idx_events_household_active
  ON events(household_id, updated_at)
  WHERE deleted_at IS NULL;

-- bills table
CREATE TABLE bills_new (
  id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  due_date INTEGER NOT NULL,
  document TEXT,
  reminder INTEGER,
  -- Cascade household deletions/updates to bills
  household_id TEXT NOT NULL REFERENCES household(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  root_key TEXT,
  relative_path TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO bills_new (id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path, position)
  SELECT id,
         amount,
         due_date,
         document,
         reminder,
         household_id,
         created_at,
         updated_at,
         NULL AS deleted_at,
         NULL AS root_key,
         NULL AS relative_path,
         0 AS position
    FROM bills;
-- Ensure unique position values before creating index
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY household_id
           ORDER BY COALESCE(position, 9e9), created_at, id
         ) - 1 AS pos
    FROM bills_new
)
UPDATE bills_new
   SET position = (SELECT pos FROM ranked WHERE ranked.id = bills_new.id);
-- Soft-delete duplicate file paths
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY household_id, root_key, relative_path
           ORDER BY created_at, id
         ) AS rn
    FROM bills_new
   WHERE root_key IS NOT NULL AND relative_path IS NOT NULL
)
UPDATE bills_new
   SET deleted_at = COALESCE(deleted_at, CAST(strftime('%s','now') AS INTEGER) * 1000)
 WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);
DROP TABLE bills;
ALTER TABLE bills_new RENAME TO bills;
CREATE INDEX bills_household_updated_idx ON bills(household_id, updated_at);
CREATE UNIQUE INDEX bills_household_file_idx
  ON bills(household_id, root_key, relative_path)
  WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX bills_household_position_idx
  ON bills(household_id, position)
  WHERE deleted_at IS NULL;

-- policies table
CREATE TABLE policies_new (
  id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  due_date INTEGER NOT NULL,
  document TEXT,
  reminder INTEGER,
  -- Cascade household deletions/updates to policies
  household_id TEXT NOT NULL REFERENCES household(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  root_key TEXT,
  relative_path TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO policies_new (id, amount, due_date, document, reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path, position)
  SELECT id,
         amount,
         due_date,
         document,
         reminder,
         household_id,
         created_at,
         updated_at,
         NULL AS deleted_at,
         NULL AS root_key,
         NULL AS relative_path,
         0 AS position
    FROM policies;
-- Ensure unique position values before creating index
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY household_id
           ORDER BY COALESCE(position, 9e9), created_at, id
         ) - 1 AS pos
    FROM policies_new
)
UPDATE policies_new
   SET position = (SELECT pos FROM ranked WHERE ranked.id = policies_new.id);
-- Soft-delete duplicate file paths
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY household_id, root_key, relative_path
           ORDER BY created_at, id
         ) AS rn
    FROM policies_new
   WHERE root_key IS NOT NULL AND relative_path IS NOT NULL
)
UPDATE policies_new
   SET deleted_at = COALESCE(deleted_at, CAST(strftime('%s','now') AS INTEGER) * 1000)
 WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);
DROP TABLE policies;
ALTER TABLE policies_new RENAME TO policies;
CREATE INDEX policies_household_updated_idx ON policies(household_id, updated_at);
CREATE UNIQUE INDEX policies_household_file_idx
  ON policies(household_id, root_key, relative_path)
  WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX policies_household_position_idx
  ON policies(household_id, position)
  WHERE deleted_at IS NULL;

-- property_documents table
CREATE TABLE property_documents_new (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  renewal_date INTEGER NOT NULL,
  document TEXT,
  reminder INTEGER,
  -- Cascade household deletions/updates to property_documents
  household_id TEXT NOT NULL REFERENCES household(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  root_key TEXT,
  relative_path TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO property_documents_new (id, description, renewal_date, document, reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path, position)
  SELECT id,
         description,
         renewal_date,
         document,
         reminder,
         household_id,
         created_at,
         updated_at,
         NULL AS deleted_at,
         NULL AS root_key,
         NULL AS relative_path,
         0 AS position
    FROM property_documents;
-- Ensure unique position values before creating index
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY household_id
           ORDER BY COALESCE(position, 9e9), created_at, id
         ) - 1 AS pos
    FROM property_documents_new
)
UPDATE property_documents_new
   SET position = (SELECT pos FROM ranked WHERE ranked.id = property_documents_new.id);
-- Soft-delete duplicate file paths
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY household_id, root_key, relative_path
           ORDER BY created_at, id
         ) AS rn
    FROM property_documents_new
   WHERE root_key IS NOT NULL AND relative_path IS NOT NULL
)
UPDATE property_documents_new
   SET deleted_at = COALESCE(deleted_at, CAST(strftime('%s','now') AS INTEGER) * 1000)
 WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);
DROP TABLE property_documents;
ALTER TABLE property_documents_new RENAME TO property_documents;
CREATE INDEX property_documents_household_updated_idx ON property_documents(household_id, updated_at);
CREATE UNIQUE INDEX property_documents_household_file_idx
  ON property_documents(household_id, root_key, relative_path)
  WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX property_documents_household_position_idx
  ON property_documents(household_id, position)
  WHERE deleted_at IS NULL;

-- inventory_items table
CREATE TABLE inventory_items_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purchase_date INTEGER,
  warranty_expiry INTEGER,
  document TEXT,
  reminder INTEGER,
  -- Cascade household deletions/updates to inventory_items
  household_id TEXT NOT NULL REFERENCES household(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  root_key TEXT,
  relative_path TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO inventory_items_new (id, name, purchase_date, warranty_expiry, document, reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path, position)
  SELECT id,
         name,
         purchase_date,
         warranty_expiry,
         document,
         reminder,
         household_id,
         created_at,
         updated_at,
         NULL AS deleted_at,
         NULL AS root_key,
         NULL AS relative_path,
         0 AS position
    FROM inventory_items;
-- Ensure unique position values before creating index
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY household_id
           ORDER BY COALESCE(position, 9e9), created_at, id
         ) - 1 AS pos
    FROM inventory_items_new
)
UPDATE inventory_items_new
   SET position = (SELECT pos FROM ranked WHERE ranked.id = inventory_items_new.id);
-- Soft-delete duplicate file paths
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY household_id, root_key, relative_path
           ORDER BY created_at, id
         ) AS rn
    FROM inventory_items_new
   WHERE root_key IS NOT NULL AND relative_path IS NOT NULL
)
UPDATE inventory_items_new
   SET deleted_at = COALESCE(deleted_at, CAST(strftime('%s','now') AS INTEGER) * 1000)
 WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);
DROP TABLE inventory_items;
ALTER TABLE inventory_items_new RENAME TO inventory_items;
CREATE INDEX inventory_items_household_updated_idx ON inventory_items(household_id, updated_at);
CREATE UNIQUE INDEX inventory_items_household_file_idx
  ON inventory_items(household_id, root_key, relative_path)
  WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX inventory_items_household_position_idx
  ON inventory_items(household_id, position)
  WHERE deleted_at IS NULL;

-- vehicles table
CREATE TABLE vehicles_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mot_date INTEGER,
  service_date INTEGER,
  mot_reminder INTEGER,
  service_reminder INTEGER,
  -- Cascade household deletions/updates to vehicles
  household_id TEXT NOT NULL REFERENCES household(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO vehicles_new (id, name, mot_date, service_date, mot_reminder, service_reminder, household_id, created_at, updated_at, deleted_at, position)
  SELECT id,
         name,
         mot_date,
         service_date,
         mot_reminder,
         service_reminder,
         household_id,
         created_at,
         updated_at,
         NULL AS deleted_at,
         0 AS position
    FROM vehicles;
-- Ensure unique position values before creating index
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY household_id
           ORDER BY COALESCE(position, 9e9), created_at, id
         ) - 1 AS pos
    FROM vehicles_new
)
UPDATE vehicles_new
   SET position = (SELECT pos FROM ranked WHERE ranked.id = vehicles_new.id);
DROP TABLE vehicles;
ALTER TABLE vehicles_new RENAME TO vehicles;
CREATE INDEX vehicles_household_updated_idx ON vehicles(household_id, updated_at);
CREATE UNIQUE INDEX vehicles_household_position_idx
  ON vehicles(household_id, position)
  WHERE deleted_at IS NULL;

-- vehicle_maintenance table
CREATE TABLE vehicle_maintenance_new (
  id TEXT PRIMARY KEY,
  -- Cascade vehicle deletions/updates to maintenance
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  date INTEGER NOT NULL,
  type TEXT NOT NULL,
  cost INTEGER,
  document TEXT,
  -- Cascade household deletions/updates to maintenance
  household_id TEXT NOT NULL REFERENCES household(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  root_key TEXT,
  relative_path TEXT
);
INSERT INTO vehicle_maintenance_new (id, vehicle_id, date, type, cost, document, household_id, created_at, updated_at, deleted_at, root_key, relative_path)
  SELECT id,
         vehicle_id,
         date,
         type,
         cost,
         document,
         household_id,
         created_at,
         updated_at,
         NULL AS deleted_at,
         NULL AS root_key,
         NULL AS relative_path
    FROM vehicle_maintenance;
-- Soft-delete duplicate file paths
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY household_id, root_key, relative_path
           ORDER BY created_at, id
         ) AS rn
    FROM vehicle_maintenance_new
   WHERE root_key IS NOT NULL AND relative_path IS NOT NULL
)
UPDATE vehicle_maintenance_new
   SET deleted_at = COALESCE(deleted_at, CAST(strftime('%s','now') AS INTEGER) * 1000)
 WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);
DROP TABLE vehicle_maintenance;
ALTER TABLE vehicle_maintenance_new RENAME TO vehicle_maintenance;
CREATE INDEX vehicle_maintenance_household_updated_idx ON vehicle_maintenance(household_id, updated_at);
CREATE INDEX vehicle_maintenance_vehicle_date_idx ON vehicle_maintenance(vehicle_id, date);
CREATE UNIQUE INDEX vehicle_maintenance_household_file_idx
  ON vehicle_maintenance(household_id, root_key, relative_path)
  WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

-- pets table
CREATE TABLE pets_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  -- Cascade household deletions/updates to pets
  household_id TEXT NOT NULL REFERENCES household(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO pets_new (id, name, type, household_id, created_at, updated_at, deleted_at, position)
  SELECT id,
         name,
         type,
         household_id,
         created_at,
         updated_at,
         NULL AS deleted_at,
         0 AS position
    FROM pets;
-- Ensure unique position values before creating index
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY household_id
           ORDER BY COALESCE(position, 9e9), created_at, id
         ) - 1 AS pos
    FROM pets_new
)
UPDATE pets_new
   SET position = (SELECT pos FROM ranked WHERE ranked.id = pets_new.id);
DROP TABLE pets;
ALTER TABLE pets_new RENAME TO pets;
CREATE INDEX pets_household_updated_idx ON pets(household_id, updated_at);
CREATE UNIQUE INDEX pets_household_position_idx
  ON pets(household_id, position)
  WHERE deleted_at IS NULL;

-- pet_medical table
CREATE TABLE pet_medical_new (
  id TEXT PRIMARY KEY,
  -- Cascade pet deletions/updates to medical records
  pet_id TEXT NOT NULL REFERENCES pets(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  date INTEGER NOT NULL,
  description TEXT NOT NULL,
  document TEXT,
  reminder INTEGER,
  -- Cascade household deletions/updates to medical records
  household_id TEXT NOT NULL REFERENCES household(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  root_key TEXT,
  relative_path TEXT
);
INSERT INTO pet_medical_new (id, pet_id, date, description, document, reminder, household_id, created_at, updated_at, deleted_at, root_key, relative_path)
  SELECT id,
         pet_id,
         date,
         description,
         document,
         reminder,
         household_id,
         created_at,
         updated_at,
         NULL AS deleted_at,
         NULL AS root_key,
         NULL AS relative_path
    FROM pet_medical;
-- Soft-delete duplicate file paths
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY household_id, root_key, relative_path
           ORDER BY created_at, id
         ) AS rn
    FROM pet_medical_new
   WHERE root_key IS NOT NULL AND relative_path IS NOT NULL
)
UPDATE pet_medical_new
   SET deleted_at = COALESCE(deleted_at, CAST(strftime('%s','now') AS INTEGER) * 1000)
 WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);
DROP TABLE pet_medical;
ALTER TABLE pet_medical_new RENAME TO pet_medical;
CREATE INDEX pet_medical_household_updated_idx ON pet_medical(household_id, updated_at);
CREATE INDEX IF NOT EXISTS pet_medical_pet_date_idx
  ON pet_medical(pet_id, date);
CREATE UNIQUE INDEX pet_medical_household_file_idx
  ON pet_medical(household_id, root_key, relative_path)
  WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

-- family_members table
CREATE TABLE family_members_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birthday INTEGER,
  notes TEXT,
  -- Cascade household deletions/updates to family_members
  household_id TEXT NOT NULL REFERENCES household(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO family_members_new (id, name, birthday, notes, household_id, created_at, updated_at, deleted_at, position)
  SELECT id,
         name,
         birthday,
         notes,
         household_id,
         created_at,
         updated_at,
         NULL AS deleted_at,
         0 AS position
    FROM family_members;
-- Ensure unique position values before creating index
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY household_id
           ORDER BY COALESCE(position, 9e9), created_at, id
         ) - 1 AS pos
    FROM family_members_new
)
UPDATE family_members_new
   SET position = (SELECT pos FROM ranked WHERE ranked.id = family_members_new.id);
DROP TABLE family_members;
ALTER TABLE family_members_new RENAME TO family_members;
CREATE INDEX family_members_household_updated_idx ON family_members(household_id, updated_at);
CREATE UNIQUE INDEX family_members_household_position_idx
  ON family_members(household_id, position)
  WHERE deleted_at IS NULL;

-- budget_categories table
CREATE TABLE budget_categories_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_budget INTEGER,
  -- Cascade household deletions/updates to budget categories
  household_id TEXT NOT NULL REFERENCES household(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO budget_categories_new (id, name, monthly_budget, household_id, created_at, updated_at, deleted_at, position)
  SELECT id,
         name,
         monthly_budget,
         household_id,
         created_at,
         updated_at,
         NULL AS deleted_at,
         0 AS position
    FROM budget_categories;
-- Ensure unique position values before creating index
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY household_id
           ORDER BY COALESCE(position, 9e9), created_at, id
         ) - 1 AS pos
    FROM budget_categories_new
)
UPDATE budget_categories_new
   SET position = (SELECT pos FROM ranked WHERE ranked.id = budget_categories_new.id);
DROP TABLE budget_categories;
ALTER TABLE budget_categories_new RENAME TO budget_categories;
CREATE INDEX budget_categories_household_updated_idx ON budget_categories(household_id, updated_at);
CREATE UNIQUE INDEX budget_categories_household_position_idx
  ON budget_categories(household_id, position)
  WHERE deleted_at IS NULL;

-- expenses table
CREATE TABLE expenses_new (
  id TEXT PRIMARY KEY,
  -- Cascade category deletions/updates to expenses
  category_id TEXT NOT NULL REFERENCES budget_categories(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  amount INTEGER NOT NULL,
  date INTEGER NOT NULL,
  description TEXT,
  -- Cascade household deletions/updates to expenses
  household_id TEXT NOT NULL REFERENCES household(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
INSERT INTO expenses_new (id, category_id, amount, date, description, household_id, created_at, updated_at, deleted_at)
  SELECT id, category_id, amount, date, description, household_id, created_at, updated_at, NULL AS deleted_at FROM expenses;
DROP TABLE expenses;
ALTER TABLE expenses_new RENAME TO expenses;
CREATE INDEX expenses_household_updated_idx ON expenses(household_id, updated_at);
CREATE INDEX IF NOT EXISTS expenses_category_date_idx
  ON expenses(category_id, date);

COMMIT;
PRAGMA foreign_keys=ON;

