PRAGMA foreign_keys=OFF;

DROP INDEX IF EXISTS idx_member_renewals_member;
DROP INDEX IF EXISTS idx_member_renewals_house_kind;
DROP TABLE IF EXISTS member_renewals;

DROP INDEX IF EXISTS idx_member_attachments_member;
DROP INDEX IF EXISTS idx_member_attachments_path;
DROP TABLE IF EXISTS member_attachments;

DROP INDEX IF EXISTS idx_notes_member;

CREATE TABLE notes__baseline (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
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

INSERT INTO notes__baseline (
  id,
  household_id,
  category_id,
  position,
  created_at,
  updated_at,
  deleted_at,
  z,
  text,
  color,
  x,
  y,
  deadline,
  deadline_tz
)
SELECT
  id,
  household_id,
  category_id,
  position,
  created_at,
  updated_at,
  deleted_at,
  z,
  text,
  color,
  x,
  y,
  deadline,
  deadline_tz
FROM notes;

DROP TABLE notes;
ALTER TABLE notes__baseline RENAME TO notes;

CREATE UNIQUE INDEX IF NOT EXISTS notes_household_position_idx
  ON notes(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_deadline_idx
  ON notes(household_id, deadline);
CREATE INDEX IF NOT EXISTS notes_household_category_deleted_idx
  ON notes(household_id, category_id, deleted_at);
CREATE INDEX IF NOT EXISTS notes_created_cursor_idx
  ON notes(household_id, created_at, id);
CREATE INDEX IF NOT EXISTS notes_scope_z_idx
  ON notes(household_id, deleted_at, z, position);

CREATE TABLE family_members__baseline (
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

INSERT INTO family_members__baseline (
  id,
  name,
  birthday,
  notes,
  household_id,
  created_at,
  updated_at,
  deleted_at,
  position
)
SELECT
  id,
  name,
  birthday,
  notes,
  household_id,
  created_at,
  updated_at,
  deleted_at,
  position
FROM family_members;

DROP TABLE family_members;
ALTER TABLE family_members__baseline RENAME TO family_members;

CREATE UNIQUE INDEX IF NOT EXISTS family_members_household_position_idx
  ON family_members(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS family_members_household_updated_idx
  ON family_members(household_id, updated_at);
DROP INDEX IF EXISTS idx_family_members_house_bday;

PRAGMA foreign_keys=ON;
