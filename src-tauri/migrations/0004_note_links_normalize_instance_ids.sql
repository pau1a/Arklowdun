-- Normalize event note links to parent anchor (strip ::suffix)
UPDATE note_links
SET entity_id = substr(entity_id, 1, instr(entity_id, '::') - 1)
WHERE entity_type = 'event'
  AND instr(entity_id, '::') > 0;

-- 2) Optional cleanup for orphaned references
-- DELETE FROM note_links
-- WHERE entity_type = 'event'
--   AND entity_id NOT IN (SELECT id FROM events);

-- 3) Helpful index (if not already present)
CREATE INDEX IF NOT EXISTS idx_note_links_event_entity
  ON note_links(entity_type, entity_id);
