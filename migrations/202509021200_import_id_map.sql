-- id: 202509021200_import_id_map
-- checksum: 61d2f4b368e1b7c9ed08ce17f17de6b17ecc119c50c2d0a90e48232d4d535c35

BEGIN;

CREATE TABLE IF NOT EXISTS import_id_map (
  entity TEXT NOT NULL,
  old_id TEXT NOT NULL,
  new_uuid TEXT NOT NULL,
  PRIMARY KEY (entity, old_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS import_id_map_new_uuid_idx
  ON import_id_map(new_uuid);

COMMIT;
