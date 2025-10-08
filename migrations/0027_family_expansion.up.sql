PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
BEGIN IMMEDIATE;

-- Contact / naming
ALTER TABLE family_members ADD COLUMN nickname TEXT;
ALTER TABLE family_members ADD COLUMN full_name TEXT;
ALTER TABLE family_members ADD COLUMN relationship TEXT;
ALTER TABLE family_members ADD COLUMN photo_path TEXT;
ALTER TABLE family_members ADD COLUMN phone_mobile TEXT;
ALTER TABLE family_members ADD COLUMN phone_home TEXT;
ALTER TABLE family_members ADD COLUMN phone_work TEXT;
ALTER TABLE family_members ADD COLUMN email TEXT;
ALTER TABLE family_members ADD COLUMN address TEXT;
ALTER TABLE family_members ADD COLUMN personal_website TEXT;
ALTER TABLE family_members ADD COLUMN social_links_json TEXT;

-- Identity & medical
ALTER TABLE family_members ADD COLUMN passport_number TEXT;
ALTER TABLE family_members ADD COLUMN passport_expiry INTEGER;
ALTER TABLE family_members ADD COLUMN driving_licence_number TEXT;
ALTER TABLE family_members ADD COLUMN driving_licence_expiry INTEGER;
ALTER TABLE family_members ADD COLUMN nhs_number TEXT;
ALTER TABLE family_members ADD COLUMN national_insurance_number TEXT;
ALTER TABLE family_members ADD COLUMN tax_id TEXT;
ALTER TABLE family_members ADD COLUMN photo_id_expiry INTEGER;
ALTER TABLE family_members ADD COLUMN blood_group TEXT;
ALTER TABLE family_members ADD COLUMN allergies TEXT;
ALTER TABLE family_members ADD COLUMN medical_notes TEXT;
ALTER TABLE family_members ADD COLUMN gp_contact TEXT;
ALTER TABLE family_members ADD COLUMN emergency_contact_name TEXT;
ALTER TABLE family_members ADD COLUMN emergency_contact_phone TEXT;

-- Finance & meta
ALTER TABLE family_members ADD COLUMN bank_accounts_json TEXT;
ALTER TABLE family_members ADD COLUMN pension_details_json TEXT;
ALTER TABLE family_members ADD COLUMN insurance_refs TEXT;
ALTER TABLE family_members ADD COLUMN tags_json TEXT;
ALTER TABLE family_members ADD COLUMN groups_json TEXT;
ALTER TABLE family_members ADD COLUMN last_verified INTEGER;
ALTER TABLE family_members ADD COLUMN verified_by TEXT;
ALTER TABLE family_members ADD COLUMN keyholder INTEGER DEFAULT 0;
ALTER TABLE family_members ADD COLUMN status TEXT DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_family_members_house_bday
  ON family_members(household_id, birthday);

CREATE TABLE IF NOT EXISTS member_attachments (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL,
  member_id     TEXT NOT NULL,
  title         TEXT,
  root_key      TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_hint     TEXT,
  added_at      INTEGER NOT NULL,
  FOREIGN KEY(household_id)
    REFERENCES household(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  FOREIGN KEY(member_id)
    REFERENCES family_members(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_attachments_path
  ON member_attachments(household_id, root_key, relative_path);

CREATE INDEX IF NOT EXISTS idx_member_attachments_member
  ON member_attachments(member_id, added_at);

CREATE TABLE IF NOT EXISTS member_renewals (
  id                 TEXT PRIMARY KEY,
  household_id       TEXT NOT NULL,
  member_id          TEXT NOT NULL,
  kind               TEXT NOT NULL,
  label              TEXT,
  expires_at         INTEGER NOT NULL,
  remind_on_expiry   INTEGER NOT NULL DEFAULT 0,
  remind_offset_days INTEGER NOT NULL DEFAULT 30,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  FOREIGN KEY(household_id)
    REFERENCES household(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  FOREIGN KEY(member_id)
    REFERENCES family_members(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_member_renewals_house_kind
  ON member_renewals(household_id, kind, expires_at);

CREATE INDEX IF NOT EXISTS idx_member_renewals_member
  ON member_renewals(member_id, expires_at);

ALTER TABLE notes ADD COLUMN member_id TEXT;

CREATE INDEX IF NOT EXISTS idx_notes_member ON notes(member_id);

COMMIT;
