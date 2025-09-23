PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
INSERT INTO schema_migrations VALUES('0001_initial.up.sql',0);
INSERT INTO schema_migrations VALUES('0002_household.up.sql',0);
INSERT INTO schema_migrations VALUES('0003_domain_tables.up.sql',0);
INSERT INTO schema_migrations VALUES('0004_add_deleted_at.up.sql',0);
INSERT INTO schema_migrations VALUES('0005_add_positions.up.sql',0);
INSERT INTO schema_migrations VALUES('0006_add_file_paths.up.sql',0);
INSERT INTO schema_migrations VALUES('0007_import_id_map.up.sql',0);
INSERT INTO schema_migrations VALUES('0008_explicit_fk_actions.up.sql',0);
INSERT INTO schema_migrations VALUES('0009_soft_delete_notes_shopping.up.sql',0);
INSERT INTO schema_migrations VALUES('0010_notes_z_index.up.sql',0);
INSERT INTO schema_migrations VALUES('0011_events_start_idx.up.sql',0);
INSERT INTO schema_migrations VALUES('0012_household_add_tz.up.sql',0);
INSERT INTO schema_migrations VALUES('0013_events_add_tz_and_utc.up.sql',0);
INSERT INTO schema_migrations VALUES('0014_events_start_at_utc_index.up.sql',0);
INSERT INTO schema_migrations VALUES('0015_vehicles_rework.up.sql',0);
INSERT INTO schema_migrations VALUES('0016_idx_bills_household_due.up.sql',0);
INSERT INTO schema_migrations VALUES('0017_events_add_rrule_exdates.up.sql',0);
INSERT INTO schema_migrations VALUES('0018_search_indexes.up.sql',0);
INSERT INTO schema_migrations VALUES('0019_files_index.up.sql',0);
INSERT INTO schema_migrations VALUES('0020_files_index_fks.up.sql',0);
INSERT INTO schema_migrations VALUES('0021_events_end_at_utc_index.up.sql',0);
INSERT INTO schema_migrations VALUES('0022_shadow_read_audit.up.sql',0);
INSERT INTO schema_migrations VALUES('0023_events_drop_legacy_time.up.sql',0);
CREATE TABLE household (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
, deleted_at INTEGER NULL, tz TEXT);
INSERT INTO household VALUES('h1','Home',0,0,NULL,'UTC');
CREATE TABLE import_id_map (
  entity TEXT NOT NULL,
  old_id TEXT NOT NULL,
  new_uuid TEXT NOT NULL,
  PRIMARY KEY (entity, old_id),
  UNIQUE (new_uuid)
);
CREATE TABLE IF NOT EXISTS "events" (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  reminder INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  tz TEXT,
  start_at_utc INTEGER NOT NULL,
  end_at_utc INTEGER,
  rrule TEXT,
  exdates TEXT
);
INSERT INTO events (
  id,
  title,
  reminder,
  household_id,
  created_at,
  updated_at,
  deleted_at,
  tz,
  start_at_utc,
  end_at_utc,
  rrule,
  exdates
) VALUES ('e1','Old Event',NULL,'h1',0,0,NULL,'UTC',1000,NULL,NULL,NULL);
CREATE TABLE IF NOT EXISTS "bills" (
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
INSERT INTO bills VALUES('b1',1000,1000,NULL,NULL,'h1',0,0,NULL,0,NULL,NULL);
INSERT INTO bills VALUES('b2',2000,1000,NULL,NULL,'h1',0,0,1,1,NULL,NULL);
CREATE TABLE IF NOT EXISTS "policies" (
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
CREATE TABLE IF NOT EXISTS "property_documents" (
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
CREATE TABLE IF NOT EXISTS "inventory_items" (
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
CREATE TABLE IF NOT EXISTS "vehicles" (
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
  position INTEGER NOT NULL DEFAULT 0,
  make TEXT,
  model TEXT,
  reg TEXT,
  vin TEXT,
  next_mot_due INTEGER,
  next_service_due INTEGER
);
INSERT INTO vehicles (
  id,
  name,
  mot_date,
  service_date,
  mot_reminder,
  service_reminder,
  household_id,
  created_at,
  updated_at,
  deleted_at,
  position,
  make,
  model,
  reg,
  vin,
  next_mot_due,
  next_service_due
) VALUES ('v1','Car',1000,2000,NULL,NULL,'h1',0,0,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL);
CREATE TABLE IF NOT EXISTS "vehicle_maintenance" (
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
INSERT INTO vehicle_maintenance VALUES('vm1','v1',1500,'oil',100,NULL,'h1',0,0,NULL,NULL,NULL);
CREATE TABLE IF NOT EXISTS "pets" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS "pet_medical" (
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
CREATE TABLE IF NOT EXISTS "family_members" (
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
CREATE TABLE IF NOT EXISTS "budget_categories" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_budget INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS "expenses" (
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
CREATE TABLE notes (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT 0,
  deleted_at   INTEGER
, z INTEGER NOT NULL DEFAULT 0);
CREATE TABLE shopping_items (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT 0,
  deleted_at   INTEGER
);
CREATE TABLE IF NOT EXISTS "files_index" (
  id INTEGER PRIMARY KEY,
  household_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  score_hint INTEGER NOT NULL DEFAULT 0,
  UNIQUE (household_id, file_id),
  FOREIGN KEY (household_id) REFERENCES household(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "files_index_meta" (
  household_id TEXT PRIMARY KEY,
  last_built_at_utc TEXT NOT NULL,
  source_row_count INTEGER NOT NULL,
  source_max_updated_utc TEXT NOT NULL,
  version INTEGER NOT NULL,
  FOREIGN KEY (household_id) REFERENCES household(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);
CREATE TABLE shadow_read_audit (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total_rows INTEGER NOT NULL DEFAULT 0,
    discrepancies INTEGER NOT NULL DEFAULT 0,
    last_event_id TEXT,
    last_household_id TEXT,
    last_tz TEXT,
    last_legacy_start_ms INTEGER,
    last_utc_start_ms INTEGER,
    last_start_delta_ms INTEGER,
    last_legacy_end_ms INTEGER,
    last_utc_end_ms INTEGER,
    last_end_delta_ms INTEGER,
    last_observed_at_ms INTEGER
);
CREATE INDEX events_household_updated_idx ON events(household_id, updated_at);
CREATE INDEX idx_events_household_active ON events(household_id, updated_at) WHERE deleted_at IS NULL;
CREATE INDEX bills_household_updated_idx ON bills(household_id, updated_at);
CREATE UNIQUE INDEX bills_household_position_idx ON bills(household_id, position) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX bills_household_file_idx ON bills(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE INDEX idx_bills_household_due ON bills(household_id, due_date);
CREATE INDEX policies_household_updated_idx ON policies(household_id, updated_at);
CREATE UNIQUE INDEX policies_household_position_idx ON policies(household_id, position) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX policies_household_file_idx ON policies(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE INDEX property_documents_household_updated_idx ON property_documents(household_id, updated_at);
CREATE UNIQUE INDEX property_documents_household_position_idx ON property_documents(household_id, position) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX property_documents_household_file_idx ON property_documents(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE INDEX inventory_items_household_updated_idx ON inventory_items(household_id, updated_at);
CREATE UNIQUE INDEX inventory_items_household_position_idx ON inventory_items(household_id, position) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX inventory_items_household_file_idx ON inventory_items(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE INDEX idx_vehicles_household_updated
  ON vehicles(household_id, updated_at);
CREATE UNIQUE INDEX vehicles_household_position_idx ON vehicles(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX vehicle_maintenance_household_updated_idx ON vehicle_maintenance(household_id, updated_at);
CREATE INDEX vehicle_maintenance_vehicle_date_idx ON vehicle_maintenance(vehicle_id, date);
CREATE UNIQUE INDEX vehicle_maintenance_household_file_idx ON vehicle_maintenance(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE INDEX pets_household_updated_idx ON pets(household_id, updated_at);
CREATE UNIQUE INDEX pets_household_position_idx ON pets(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX pet_medical_household_updated_idx ON pet_medical(household_id, updated_at);
CREATE INDEX pet_medical_pet_date_idx ON pet_medical(pet_id, date);
CREATE UNIQUE INDEX pet_medical_household_file_idx ON pet_medical(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE INDEX family_members_household_updated_idx ON family_members(household_id, updated_at);
CREATE UNIQUE INDEX family_members_household_position_idx ON family_members(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX budget_categories_household_updated_idx ON budget_categories(household_id, updated_at);
CREATE UNIQUE INDEX budget_categories_household_position_idx ON budget_categories(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX expenses_household_updated_idx ON expenses(household_id, updated_at);
CREATE INDEX expenses_category_date_idx ON expenses(category_id, date);
CREATE INDEX notes_scope_idx
  ON notes(household_id, deleted_at, position);
CREATE UNIQUE INDEX notes_household_position_idx
  ON notes(household_id, position)
  WHERE deleted_at IS NULL;
CREATE INDEX shopping_scope_idx
  ON shopping_items(household_id, deleted_at, position);
CREATE UNIQUE INDEX shopping_household_position_idx
  ON shopping_items(household_id, position)
  WHERE deleted_at IS NULL;
CREATE INDEX notes_scope_z_idx ON notes(household_id, deleted_at, z, position);
CREATE INDEX events_household_start_at_utc_idx ON events(household_id, start_at_utc);
CREATE INDEX events_household_end_at_utc_idx ON events(household_id, end_at_utc);
CREATE INDEX idx_events_household_rrule ON events(household_id, rrule);
CREATE INDEX idx_events_household_title ON events(household_id, title);
CREATE VIEW IF NOT EXISTS notes_live AS
  SELECT * FROM notes WHERE deleted_at IS NULL;
CREATE VIEW IF NOT EXISTS shopping_live AS
  SELECT * FROM shopping_items WHERE deleted_at IS NULL;
COMMIT;
