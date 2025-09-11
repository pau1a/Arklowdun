-- id: 202509020900_add_positions
-- checksum: a619c37adf7207c53c6a5f17bcb0334ee405708caa7b6892d301427cd3296836


-- 1) Add columns (no index yet)
ALTER TABLE bills              ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE policies           ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE property_documents ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_items    ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vehicles           ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pets               ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE family_members     ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budget_categories  ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

-- 2) Backfill positions per household, compacting from 0
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY household_id ORDER BY created_at, id) - 1 AS new_pos
  FROM bills
  WHERE deleted_at IS NULL
)
UPDATE bills
SET position = (SELECT new_pos FROM ordered WHERE ordered.id = bills.id)
WHERE id IN (SELECT id FROM ordered);

WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY household_id ORDER BY created_at, id) - 1 AS new_pos
  FROM policies
  WHERE deleted_at IS NULL
)
UPDATE policies
SET position = (SELECT new_pos FROM ordered WHERE ordered.id = policies.id)
WHERE id IN (SELECT id FROM ordered);

WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY household_id ORDER BY created_at, id) - 1 AS new_pos
  FROM property_documents
  WHERE deleted_at IS NULL
)
UPDATE property_documents
SET position = (SELECT new_pos FROM ordered WHERE ordered.id = property_documents.id)
WHERE id IN (SELECT id FROM ordered);

WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY household_id ORDER BY created_at, id) - 1 AS new_pos
  FROM inventory_items
  WHERE deleted_at IS NULL
)
UPDATE inventory_items
SET position = (SELECT new_pos FROM ordered WHERE ordered.id = inventory_items.id)
WHERE id IN (SELECT id FROM ordered);

WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY household_id ORDER BY created_at, id) - 1 AS new_pos
  FROM vehicles
  WHERE deleted_at IS NULL
)
UPDATE vehicles
SET position = (SELECT new_pos FROM ordered WHERE ordered.id = vehicles.id)
WHERE id IN (SELECT id FROM ordered);

WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY household_id ORDER BY created_at, id) - 1 AS new_pos
  FROM pets
  WHERE deleted_at IS NULL
)
UPDATE pets
SET position = (SELECT new_pos FROM ordered WHERE ordered.id = pets.id)
WHERE id IN (SELECT id FROM ordered);

WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY household_id ORDER BY created_at, id) - 1 AS new_pos
  FROM family_members
  WHERE deleted_at IS NULL
)
UPDATE family_members
SET position = (SELECT new_pos FROM ordered WHERE ordered.id = family_members.id)
WHERE id IN (SELECT id FROM ordered);

WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY household_id ORDER BY created_at, id) - 1 AS new_pos
  FROM budget_categories
  WHERE deleted_at IS NULL
)
UPDATE budget_categories
SET position = (SELECT new_pos FROM ordered WHERE ordered.id = budget_categories.id)
WHERE id IN (SELECT id FROM ordered);

-- 3) Partial unique indexes (ignore soft-deleted rows)
CREATE UNIQUE INDEX IF NOT EXISTS bills_household_position_idx
  ON bills(household_id, position) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS policies_household_position_idx
  ON policies(household_id, position) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS property_documents_household_position_idx
  ON property_documents(household_id, position) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_household_position_idx
  ON inventory_items(household_id, position) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_household_position_idx
  ON vehicles(household_id, position) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pets_household_position_idx
  ON pets(household_id, position) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS family_members_household_position_idx
  ON family_members(household_id, position) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS budget_categories_household_position_idx
  ON budget_categories(household_id, position) WHERE deleted_at IS NULL;

