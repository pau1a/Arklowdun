CREATE TABLE IF NOT EXISTS shadow_read_audit (
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
