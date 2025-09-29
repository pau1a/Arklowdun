-- Roll back note_links introduction

-- Drop secondary indexes first (safe even if they don't exist)
DROP INDEX IF EXISTS note_links_unique;
DROP INDEX IF EXISTS note_links_context_idx;
DROP INDEX IF EXISTS note_links_note_idx;

-- Drop the table
DROP TABLE IF EXISTS note_links;
