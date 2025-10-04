CREATE TABLE IF NOT EXISTS events_backfill_checkpoint (
    household_id TEXT PRIMARY KEY,
    last_rowid INTEGER NOT NULL DEFAULT 0,
    processed INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
