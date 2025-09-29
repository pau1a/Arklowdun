-- Links notes to contextual entities (events and indexed files)
CREATE TABLE note_links (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE ON UPDATE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('event','file')),
  entity_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'attached_to',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX note_links_unique
  ON note_links (household_id, note_id, entity_type, entity_id);

CREATE INDEX note_links_context_idx
  ON note_links (household_id, entity_type, entity_id);

CREATE INDEX note_links_note_idx
  ON note_links (household_id, note_id);
