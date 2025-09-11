-- id: 202509021100_add_file_paths

BEGIN;

-- 1) Add nullable columns
ALTER TABLE bills               ADD COLUMN root_key TEXT;
ALTER TABLE bills               ADD COLUMN relative_path TEXT;

ALTER TABLE policies            ADD COLUMN root_key TEXT;
ALTER TABLE policies            ADD COLUMN relative_path TEXT;

ALTER TABLE property_documents  ADD COLUMN root_key TEXT;
ALTER TABLE property_documents  ADD COLUMN relative_path TEXT;

ALTER TABLE inventory_items     ADD COLUMN root_key TEXT;
ALTER TABLE inventory_items     ADD COLUMN relative_path TEXT;

ALTER TABLE vehicle_maintenance ADD COLUMN root_key TEXT;
ALTER TABLE vehicle_maintenance ADD COLUMN relative_path TEXT;

ALTER TABLE pet_medical         ADD COLUMN root_key TEXT;
ALTER TABLE pet_medical         ADD COLUMN relative_path TEXT;

-- 2) Backfill from legacy `document` (normalize slashes; strip leading '/')
-- SQLite: use REPLACE + LTRIM
UPDATE bills
   SET root_key = COALESCE(root_key, 'appData'),
       relative_path = COALESCE(relative_path, LTRIM(REPLACE(document, '\\', '/'), '/'))
 WHERE document IS NOT NULL;

UPDATE policies
   SET root_key = COALESCE(root_key, 'appData'),
       relative_path = COALESCE(relative_path, LTRIM(REPLACE(document, '\\', '/'), '/'))
 WHERE document IS NOT NULL;

UPDATE property_documents
   SET root_key = COALESCE(root_key, 'appData'),
       relative_path = COALESCE(relative_path, LTRIM(REPLACE(document, '\\', '/'), '/'))
 WHERE document IS NOT NULL;

UPDATE inventory_items
   SET root_key = COALESCE(root_key, 'appData'),
       relative_path = COALESCE(relative_path, LTRIM(REPLACE(document, '\\', '/'), '/'))
 WHERE document IS NOT NULL;

UPDATE vehicle_maintenance
   SET root_key = COALESCE(root_key, 'appData'),
       relative_path = COALESCE(relative_path, LTRIM(REPLACE(document, '\\', '/'), '/'))
 WHERE document IS NOT NULL;

UPDATE pet_medical
   SET root_key = COALESCE(root_key, 'appData'),
       relative_path = COALESCE(relative_path, LTRIM(REPLACE(document, '\\', '/'), '/'))
 WHERE document IS NOT NULL;

-- 3) Partial unique indexes (ignore soft-deleted or NULL pairs)
CREATE UNIQUE INDEX IF NOT EXISTS bills_household_file_idx
  ON bills(household_id, root_key, relative_path)
  WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS policies_household_file_idx
  ON policies(household_id, root_key, relative_path)
  WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS property_documents_household_file_idx
  ON property_documents(household_id, root_key, relative_path)
  WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_household_file_idx
  ON inventory_items(household_id, root_key, relative_path)
  WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_maintenance_household_file_idx
  ON vehicle_maintenance(household_id, root_key, relative_path)
  WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pet_medical_household_file_idx
  ON pet_medical(household_id, root_key, relative_path)
  WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;

COMMIT;
