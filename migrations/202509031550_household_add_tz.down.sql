CREATE TABLE household_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER,
  deleted_at INTEGER
);
INSERT INTO household_new (id, name, created_at, updated_at, deleted_at)
  SELECT id, name, created_at, updated_at, deleted_at FROM household;
DROP TABLE household;
ALTER TABLE household_new RENAME TO household;
