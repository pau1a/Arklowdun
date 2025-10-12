PRAGMA foreign_keys=OFF;

DROP INDEX IF EXISTS pets_household_image_idx;

CREATE TABLE pets__baseline (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);

INSERT INTO pets__baseline (
  id,
  name,
  type,
  household_id,
  created_at,
  updated_at,
  deleted_at,
  position
)
SELECT
  id,
  name,
  type,
  household_id,
  created_at,
  updated_at,
  deleted_at,
  position
FROM pets;

DROP TABLE pets;
ALTER TABLE pets__baseline RENAME TO pets;

CREATE UNIQUE INDEX IF NOT EXISTS pets_household_position_idx
  ON pets(household_id, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pets_household_updated_idx
  ON pets(household_id, updated_at);

PRAGMA foreign_keys=ON;
