-- 0001_baseline.sql
-- Canonical schema baseline for Arklowdun.
-- Apply this migration to create an empty database with seeded household and categories.

-- Core tables
CREATE TABLE household (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER,
  deleted_at INTEGER,
  tz TEXT
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  z INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE events (
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

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  z INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#FFF4B8',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  deadline INTEGER,
  deadline_tz TEXT
);

CREATE TABLE files_index (
  id INTEGER PRIMARY KEY,
  household_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  score_hint INTEGER NOT NULL DEFAULT 0,
  UNIQUE (household_id, file_id),
  FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE files_index_meta (
  household_id TEXT PRIMARY KEY,
  last_built_at_utc TEXT NOT NULL,
  source_row_count INTEGER NOT NULL,
  source_max_updated_utc TEXT NOT NULL,
  version INTEGER NOT NULL,
  FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Legacy domain tables retained for feature parity
CREATE TABLE bills (
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

CREATE TABLE budget_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_budget INTEGER,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE expenses (
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

CREATE TABLE family_members (
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

CREATE TABLE import_id_map (
  entity TEXT NOT NULL,
  old_id TEXT NOT NULL,
  new_uuid TEXT NOT NULL,
  PRIMARY KEY (entity, old_id),
  UNIQUE (new_uuid)
);

CREATE TABLE inventory_items (
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

CREATE TABLE pets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE pet_medical (
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

CREATE TABLE policies (
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

CREATE TABLE property_documents (
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

CREATE TABLE shopping_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE vehicles (
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

CREATE TABLE vehicle_maintenance (
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

CREATE VIEW IF NOT EXISTS shopping_live AS
  SELECT * FROM shopping_items WHERE deleted_at IS NULL;

-- Indexes
CREATE UNIQUE INDEX bills_household_file_idx ON bills(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX bills_household_position_idx ON bills(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX bills_household_updated_idx ON bills(household_id, updated_at);
CREATE UNIQUE INDEX budget_categories_household_position_idx ON budget_categories(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX budget_categories_household_updated_idx ON budget_categories(household_id, updated_at);
CREATE UNIQUE INDEX categories_household_position_idx ON categories(household_id, position) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX categories_household_slug_idx ON categories(household_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX categories_household_updated_idx ON categories(household_id, updated_at);
CREATE INDEX events_household_end_at_utc_idx ON events(household_id, end_at_utc);
CREATE INDEX events_household_start_at_utc_idx ON events(household_id, start_at_utc);
CREATE INDEX events_household_updated_idx ON events(household_id, updated_at);
CREATE INDEX expenses_category_date_idx ON expenses(category_id, date);
CREATE INDEX expenses_household_updated_idx ON expenses(household_id, updated_at);
CREATE UNIQUE INDEX family_members_household_position_idx ON family_members(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX family_members_household_updated_idx ON family_members(household_id, updated_at);
CREATE INDEX idx_bills_household_due ON bills(household_id, due_date);
CREATE INDEX idx_events_household_active ON events(household_id, updated_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_events_household_rrule ON events(household_id, rrule);
CREATE INDEX idx_events_household_title ON events(household_id, title);
CREATE INDEX idx_vehicles_household_updated ON vehicles(household_id, updated_at);
CREATE UNIQUE INDEX inventory_items_household_file_idx ON inventory_items(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX inventory_items_household_position_idx ON inventory_items(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX inventory_items_household_updated_idx ON inventory_items(household_id, updated_at);
CREATE UNIQUE INDEX notes_household_position_idx ON notes(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX notes_scope_idx ON notes(household_id, deleted_at, position);
CREATE INDEX notes_scope_z_idx ON notes(household_id, deleted_at, z, position);
CREATE INDEX notes_deadline_idx ON notes(household_id, deadline) WHERE deadline IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX pet_medical_household_file_idx ON pet_medical(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE INDEX pet_medical_household_updated_idx ON pet_medical(household_id, updated_at);
CREATE INDEX pet_medical_pet_date_idx ON pet_medical(pet_id, date);
CREATE UNIQUE INDEX pets_household_position_idx ON pets(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX pets_household_updated_idx ON pets(household_id, updated_at);
CREATE UNIQUE INDEX policies_household_file_idx ON policies(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX policies_household_position_idx ON policies(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX policies_household_updated_idx ON policies(household_id, updated_at);
CREATE UNIQUE INDEX property_documents_household_file_idx ON property_documents(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE UNIQUE INDEX property_documents_household_position_idx ON property_documents(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX property_documents_household_updated_idx ON property_documents(household_id, updated_at);
CREATE UNIQUE INDEX shopping_household_position_idx ON shopping_items(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX shopping_scope_idx ON shopping_items(household_id, deleted_at, position);
CREATE UNIQUE INDEX vehicle_maintenance_household_file_idx ON vehicle_maintenance(household_id, root_key, relative_path) WHERE deleted_at IS NULL AND root_key IS NOT NULL AND relative_path IS NOT NULL;
CREATE INDEX vehicle_maintenance_household_updated_idx ON vehicle_maintenance(household_id, updated_at);
CREATE INDEX vehicle_maintenance_vehicle_date_idx ON vehicle_maintenance(vehicle_id, date);
CREATE UNIQUE INDEX vehicles_household_position_idx ON vehicles(household_id, position) WHERE deleted_at IS NULL;

-- Seeds
INSERT INTO household (id, name, created_at, updated_at, deleted_at, tz)
VALUES ('default', 'Default Household', 1672531200000, 1672531200000, NULL, 'UTC');

INSERT INTO categories (id, household_id, name, slug, color, position, z, created_at, updated_at, deleted_at)
VALUES
  ('cat_primary',   'default', 'Primary',   'primary',   '#4F46E5', 0, 0, 1672531200000, 1672531200000, NULL),
  ('cat_secondary', 'default', 'Secondary', 'secondary', '#1D4ED8', 1, 0, 1672531200000, 1672531200000, NULL),
  ('cat_tasks',     'default', 'Tasks',     'tasks',     '#0EA5E9', 2, 0, 1672531200000, 1672531200000, NULL),
  ('cat_bills',     'default', 'Bills',     'bills',     '#F59E0B', 3, 0, 1672531200000, 1672531200000, NULL),
  ('cat_insurance', 'default', 'Insurance', 'insurance', '#EA580C', 4, 0, 1672531200000, 1672531200000, NULL),
  ('cat_property',  'default', 'Property',  'property',  '#F97316', 5, 0, 1672531200000, 1672531200000, NULL),
  ('cat_vehicles',  'default', 'Vehicles',  'vehicles',  '#22C55E', 6, 0, 1672531200000, 1672531200000, NULL),
  ('cat_pets',      'default', 'Pets',      'pets',      '#16A34A', 7, 0, 1672531200000, 1672531200000, NULL),
  ('cat_family',    'default', 'Family',    'family',    '#EF4444', 8, 0, 1672531200000, 1672531200000, NULL),
  ('cat_inventory', 'default', 'Inventory', 'inventory', '#C026D3', 9, 0, 1672531200000, 1672531200000, NULL),
  ('cat_budget',    'default', 'Budget',    'budget',    '#A855F7', 10, 0, 1672531200000, 1672531200000, NULL),
  ('cat_shopping',  'default', 'Shopping',  'shopping',  '#6366F1', 11, 0, 1672531200000, 1672531200000, NULL);

-- Record baseline version in schema_migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES (
  '0001_baseline.sql',
  CAST(strftime('%s','now') AS INTEGER) * 1000
);
