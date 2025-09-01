-- Replace YYYYMMDDhhmm with a real UTC timestamp when creating the initial migration.
BEGIN;

CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  checksum TEXT NOT NULL
);

COMMIT;
