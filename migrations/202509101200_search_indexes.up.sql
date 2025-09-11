-- Prefix search indexes for files and events
CREATE INDEX IF NOT EXISTS idx_files_household_filename ON files(household_id, filename);
CREATE INDEX IF NOT EXISTS idx_events_household_title ON events(household_id, title);

