CREATE TABLE IF NOT EXISTS cascade_checkpoints (
  household_id TEXT PRIMARY KEY,
  phase_index INTEGER NOT NULL,
  deleted_count INTEGER NOT NULL,
  total INTEGER NOT NULL,
  phase TEXT NOT NULL,
  updated_at_utc INTEGER NOT NULL,
  vacuum_pending INTEGER NOT NULL DEFAULT 0,
  remaining_paths INTEGER NOT NULL DEFAULT 0
);
