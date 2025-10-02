-- Enforce explicit default household invariants and guards
ALTER TABLE household ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;

UPDATE household
SET is_default = 1
WHERE id = 'default' AND (is_default IS NULL OR is_default = 0);

UPDATE household
SET is_default = 1
WHERE id IN (
  SELECT id FROM household
  WHERE deleted_at IS NULL
  ORDER BY COALESCE(created_at, 0) ASC, id ASC
  LIMIT 1
)
AND (SELECT COUNT(*) FROM household WHERE is_default = 1) = 0;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY COALESCE(created_at, 0) ASC, id ASC) AS rn
  FROM household
  WHERE is_default = 1
)
UPDATE household
SET is_default = 0
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE TRIGGER IF NOT EXISTS trg_households_one_default_on_update
BEFORE UPDATE OF is_default ON household
WHEN NEW.is_default = 1
BEGIN
  UPDATE household SET is_default = 0 WHERE id <> NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_households_one_default_on_insert
BEFORE INSERT ON household
WHEN NEW.is_default = 1
BEGIN
  UPDATE household SET is_default = 0;
END;

CREATE TRIGGER IF NOT EXISTS trg_households_must_have_default_on_update
BEFORE UPDATE OF is_default ON household
WHEN OLD.is_default = 1 AND NEW.is_default = 0
  AND (SELECT COUNT(*) FROM household WHERE is_default = 1) = 1
BEGIN
  SELECT RAISE(ABORT, 'must_have_one_default');
END;

CREATE TRIGGER IF NOT EXISTS trg_households_forbid_delete_default
BEFORE DELETE ON household
WHEN OLD.is_default = 1
BEGIN
  SELECT RAISE(ABORT, 'default_household_undeletable');
END;

CREATE TRIGGER IF NOT EXISTS trg_households_forbid_soft_delete_default
BEFORE UPDATE OF deleted_at ON household
WHEN OLD.is_default = 1 AND NEW.deleted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'default_household_undeletable');
END;
