-- id: 202509020800_add_deleted_at
-- Add deleted_at column to all domain tables for soft deletion

BEGIN;
ALTER TABLE household ADD COLUMN deleted_at INTEGER;
ALTER TABLE events ADD COLUMN deleted_at INTEGER;
ALTER TABLE bills ADD COLUMN deleted_at INTEGER;
ALTER TABLE policies ADD COLUMN deleted_at INTEGER;
ALTER TABLE property_documents ADD COLUMN deleted_at INTEGER;
ALTER TABLE inventory_items ADD COLUMN deleted_at INTEGER;
ALTER TABLE vehicles ADD COLUMN deleted_at INTEGER;
ALTER TABLE vehicle_maintenance ADD COLUMN deleted_at INTEGER;
ALTER TABLE pets ADD COLUMN deleted_at INTEGER;
ALTER TABLE pet_medical ADD COLUMN deleted_at INTEGER;
ALTER TABLE family_members ADD COLUMN deleted_at INTEGER;
ALTER TABLE budget_categories ADD COLUMN deleted_at INTEGER;
ALTER TABLE expenses ADD COLUMN deleted_at INTEGER;
COMMIT;
