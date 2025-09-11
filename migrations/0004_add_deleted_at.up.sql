-- id: 202509020800_add_deleted_at
-- checksum: 6c167b38d3c702beba80db645309a08eaa956d103b51cfb518f3eb3e143d2e66
-- Add deleted_at column to all domain tables for soft deletion

ALTER TABLE household ADD COLUMN deleted_at INTEGER NULL;
ALTER TABLE events ADD COLUMN deleted_at INTEGER NULL;
ALTER TABLE bills ADD COLUMN deleted_at INTEGER NULL;
ALTER TABLE policies ADD COLUMN deleted_at INTEGER NULL;
ALTER TABLE property_documents ADD COLUMN deleted_at INTEGER NULL;
ALTER TABLE inventory_items ADD COLUMN deleted_at INTEGER NULL;
ALTER TABLE vehicles ADD COLUMN deleted_at INTEGER NULL;
ALTER TABLE vehicle_maintenance ADD COLUMN deleted_at INTEGER NULL;
ALTER TABLE pets ADD COLUMN deleted_at INTEGER NULL;
ALTER TABLE pet_medical ADD COLUMN deleted_at INTEGER NULL;
ALTER TABLE family_members ADD COLUMN deleted_at INTEGER NULL;
ALTER TABLE budget_categories ADD COLUMN deleted_at INTEGER NULL;
ALTER TABLE expenses ADD COLUMN deleted_at INTEGER NULL;
CREATE INDEX IF NOT EXISTS idx_events_household_active
  ON events(household_id, updated_at) WHERE deleted_at IS NULL;
