-- 0023_vault_categories.down.sql
-- Best-effort reversal: drop new unique indexes and recreate the legacy root_key scoped indexes.

DROP INDEX IF EXISTS bills_household_category_path_idx;
DROP INDEX IF EXISTS inventory_items_household_category_path_idx;
DROP INDEX IF EXISTS pet_medical_household_category_path_idx;
DROP INDEX IF EXISTS policies_household_category_path_idx;
DROP INDEX IF EXISTS property_documents_household_category_path_idx;
DROP INDEX IF EXISTS vehicle_maintenance_household_category_path_idx;

CREATE UNIQUE INDEX IF NOT EXISTS bills_household_file_idx
    ON bills(household_id, root_key, relative_path)
    WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_household_file_idx
    ON inventory_items(household_id, root_key, relative_path)
    WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pet_medical_household_file_idx
    ON pet_medical(household_id, root_key, relative_path)
    WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS policies_household_file_idx
    ON policies(household_id, root_key, relative_path)
    WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS property_documents_household_file_idx
    ON property_documents(household_id, root_key, relative_path)
    WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_maintenance_household_file_idx
    ON vehicle_maintenance(household_id, root_key, relative_path)
    WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
