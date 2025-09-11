-- id: 202509011559_initial
-- checksum: 5f7a21296fa1df9a43ee342c82e6f8488b645fb7f4ba072752e718c46dfc9a43

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
