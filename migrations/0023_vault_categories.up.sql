-- 0023_vault_categories.up.sql
-- Introduce attachment categories for all attachment-bearing tables and
-- replace legacy uniqueness constraints to scope by household + category + relative_path.

PRAGMA foreign_keys = OFF;

ALTER TABLE bills
    ADD COLUMN category TEXT NOT NULL DEFAULT 'bills'
        CHECK (category IN ('bills','policies','property_documents','inventory_items','pet_medical','vehicles','vehicle_maintenance','notes','misc'));
ALTER TABLE inventory_items
    ADD COLUMN category TEXT NOT NULL DEFAULT 'inventory_items'
        CHECK (category IN ('bills','policies','property_documents','inventory_items','pet_medical','vehicles','vehicle_maintenance','notes','misc'));
ALTER TABLE pet_medical
    ADD COLUMN category TEXT NOT NULL DEFAULT 'pet_medical'
        CHECK (category IN ('bills','policies','property_documents','inventory_items','pet_medical','vehicles','vehicle_maintenance','notes','misc'));
ALTER TABLE policies
    ADD COLUMN category TEXT NOT NULL DEFAULT 'policies'
        CHECK (category IN ('bills','policies','property_documents','inventory_items','pet_medical','vehicles','vehicle_maintenance','notes','misc'));
ALTER TABLE property_documents
    ADD COLUMN category TEXT NOT NULL DEFAULT 'property_documents'
        CHECK (category IN ('bills','policies','property_documents','inventory_items','pet_medical','vehicles','vehicle_maintenance','notes','misc'));
ALTER TABLE vehicle_maintenance
    ADD COLUMN category TEXT NOT NULL DEFAULT 'vehicle_maintenance'
        CHECK (category IN ('bills','policies','property_documents','inventory_items','pet_medical','vehicles','vehicle_maintenance','notes','misc'));

DROP INDEX IF EXISTS bills_household_file_idx;
DROP INDEX IF EXISTS inventory_items_household_file_idx;
DROP INDEX IF EXISTS pet_medical_household_file_idx;
DROP INDEX IF EXISTS policies_household_file_idx;
DROP INDEX IF EXISTS property_documents_household_file_idx;
DROP INDEX IF EXISTS vehicle_maintenance_household_file_idx;

CREATE UNIQUE INDEX bills_household_category_path_idx
    ON bills(household_id, category, relative_path)
    WHERE deleted_at IS NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX inventory_items_household_category_path_idx
    ON inventory_items(household_id, category, relative_path)
    WHERE deleted_at IS NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX pet_medical_household_category_path_idx
    ON pet_medical(household_id, category, relative_path)
    WHERE deleted_at IS NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX policies_household_category_path_idx
    ON policies(household_id, category, relative_path)
    WHERE deleted_at IS NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX property_documents_household_category_path_idx
    ON property_documents(household_id, category, relative_path)
    WHERE deleted_at IS NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX vehicle_maintenance_household_category_path_idx
    ON vehicle_maintenance(household_id, category, relative_path)
    WHERE deleted_at IS NULL AND relative_path IS NOT NULL;

PRAGMA foreign_keys = ON;
