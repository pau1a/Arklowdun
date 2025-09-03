-- id: 202509021200_import_id_map
-- checksum: bc0d8f7c1b34bff4e922a4b7554e15e28ca3ec88fd1119dd67effb537a8940c8

BEGIN;

CREATE TABLE IF NOT EXISTS import_id_map (
  entity TEXT NOT NULL,
  old_id TEXT NOT NULL,
  new_uuid TEXT NOT NULL,
  PRIMARY KEY (entity, old_id),
  UNIQUE (new_uuid)
);

COMMIT;
