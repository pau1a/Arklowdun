-- id: 202509021200_import_id_map

BEGIN;

CREATE TABLE IF NOT EXISTS import_id_map (
  entity TEXT NOT NULL,
  old_id TEXT NOT NULL,
  new_uuid TEXT NOT NULL,
  PRIMARY KEY (entity, old_id),
  UNIQUE (new_uuid)
);

COMMIT;
