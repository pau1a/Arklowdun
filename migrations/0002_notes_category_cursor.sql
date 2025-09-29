-- PR-03 Notes Refactor backfill and indexes
-- Ensure every existing note has a category_id and add supporting indexes

BEGIN TRANSACTION;

-- Backfill missing or invalid category references to the household "primary" category.
WITH primary_categories AS (
    SELECT household_id, id
      FROM categories
     WHERE slug = 'primary'
       AND deleted_at IS NULL
)
UPDATE notes
   SET category_id = (
       SELECT pc.id
         FROM primary_categories pc
        WHERE pc.household_id = notes.household_id
   )
 WHERE (
       category_id IS NULL
       OR NOT EXISTS (
           SELECT 1
             FROM categories c
            WHERE c.id = notes.category_id
              AND c.household_id = notes.household_id
       )
 );

-- Drop legacy indexes superseded by cursor pagination support.
DROP INDEX IF EXISTS notes_scope_idx;
DROP INDEX IF EXISTS notes_scope_z_idx;
DROP INDEX IF EXISTS notes_household_category_idx;

-- Recreate indexes aligned with the cursor strategy and category lookups.
CREATE INDEX IF NOT EXISTS notes_household_category_deleted_idx
    ON notes(household_id, category_id, deleted_at);

CREATE INDEX IF NOT EXISTS notes_created_cursor_idx
    ON notes(household_id, created_at, id);

-- Preserve an index to support the legacy z-order lookups for existing UI interactions.
CREATE INDEX IF NOT EXISTS notes_scope_z_idx
    ON notes(household_id, deleted_at, z, position);

COMMIT;
