# Schema changes (PR1)

This document specifies the exact database evolution for PR1. The commands apply to SQLite as used by the Tauri runtime and must be mirrored in `schema.sql` and any snapshot schemas. All new columns are additive and nullable unless noted otherwise. Existing tables keep their current column ordering; the listing below reflects the order enforced in the migration scripts.

## Migration files
- `migrations/0027_family_expansion.up.sql`
- `migrations/0027_family_expansion.down.sql`

The up migration is authoritative. The down migration reverses each step to restore the PR0 baseline without data reordering.

## family_members alterations

```sql
ALTER TABLE family_members
  ADD COLUMN nickname TEXT,
  ADD COLUMN full_name TEXT,
  ADD COLUMN relationship TEXT,
  ADD COLUMN photo_path TEXT,
  ADD COLUMN phone_mobile TEXT,
  ADD COLUMN phone_home TEXT,
  ADD COLUMN phone_work TEXT,
  ADD COLUMN email TEXT,
  ADD COLUMN address TEXT,
  ADD COLUMN personal_website TEXT,
  ADD COLUMN social_links_json TEXT,
  ADD COLUMN passport_number TEXT,
  ADD COLUMN passport_expiry INTEGER,
  ADD COLUMN driving_licence_number TEXT,
  ADD COLUMN driving_licence_expiry INTEGER,
  ADD COLUMN nhs_number TEXT,
  ADD COLUMN national_insurance_number TEXT,
  ADD COLUMN tax_id TEXT,
  ADD COLUMN photo_id_expiry INTEGER,
  ADD COLUMN blood_group TEXT,
  ADD COLUMN allergies TEXT,
  ADD COLUMN medical_notes TEXT,
  ADD COLUMN gp_contact TEXT,
  ADD COLUMN emergency_contact_name TEXT,
  ADD COLUMN emergency_contact_phone TEXT,
  ADD COLUMN bank_accounts_json TEXT,
  ADD COLUMN pension_details_json TEXT,
  ADD COLUMN insurance_refs TEXT,
  ADD COLUMN tags_json TEXT,
  ADD COLUMN groups_json TEXT,
  ADD COLUMN last_verified INTEGER,
  ADD COLUMN verified_by TEXT,
  ADD COLUMN keyholder INTEGER DEFAULT 0,
  ADD COLUMN status TEXT DEFAULT 'active'
;
```

### Field notes
- `nickname` becomes the primary display name in the UI when populated. Until a backfill runs, the renderer treats `name` as the fallback nickname.
- `photo_path` stores a vault-relative path (`root_key` + `relative_path` combination lives in `member_attachments`).
- `*_json` fields are opaque JSON strings persisted without validation at the SQL layer. Renderer-level validation ensures the shapes described in [ui_spec.md](ui_spec.md).
- `passport_expiry`, `driving_licence_expiry`, `photo_id_expiry`, and `last_verified` store epoch milliseconds (`INTEGER`).
- `keyholder` is a boolean represented as `0`/`1` in SQLite; higher layers convert to/from `true`/`false`.
- `status` accepts `active`, `inactive`, or `deceased`. No check constraint is added to avoid SQLite rewrite overhead; validation occurs in the renderer.

### Indexing

```sql
CREATE INDEX IF NOT EXISTS idx_family_members_house_bday
  ON family_members(household_id, birthday);
```

This index accelerates upcoming birthday lookups for the banner. It remains even if PR5 feature flags are toggled off.

## member_attachments table

```sql
CREATE TABLE IF NOT EXISTS member_attachments (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  title TEXT,
  root_key TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_hint TEXT,
  added_at INTEGER NOT NULL,
  FOREIGN KEY(member_id) REFERENCES family_members(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_attachments_path
  ON member_attachments(household_id, root_key, relative_path);
CREATE INDEX IF NOT EXISTS idx_member_attachments_member
  ON member_attachments(member_id, added_at);
```

- `root_key` identifies the vault partition; `relative_path` is the scoped path inside that root. The unique index forbids duplicate file references per household.
- Attachments cascade-delete with their owning member.
- `added_at` captures epoch milliseconds for audit displays.

## member_renewals table

```sql
CREATE TABLE IF NOT EXISTS member_renewals (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT,
  expires_at INTEGER NOT NULL,
  remind_on_expiry INTEGER NOT NULL DEFAULT 0,
  remind_offset_days INTEGER NOT NULL DEFAULT 30,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(member_id) REFERENCES family_members(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_member_renewals_house_kind
  ON member_renewals(household_id, kind, expires_at);
CREATE INDEX IF NOT EXISTS idx_member_renewals_member
  ON member_renewals(member_id, expires_at);
```

- `kind` is a free-form string, with renderer validation restricting values to documented kinds (`passport`, `driving_licence`, `photo_id`, `insurance`, `pension`, plus allow-listed future variants).
- `remind_on_expiry` is an INTEGER treated as boolean.
- `remind_offset_days` defaults to 30 and must remain non-negative.
- Sorting by `(member_id, expires_at)` supports list rendering in [ui_spec.md](ui_spec.md).

## notes table alteration

```sql
ALTER TABLE notes ADD COLUMN member_id TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_member ON notes(member_id);
```

- The column is nullable to preserve household-level notes. Only PR10 consumes the linkage.
- No foreign key is added in SQLite to avoid table rebuilds; application logic enforces referential consistency and handles soft-deleted members as documented in [notes_linking.md](notes_linking.md).

## Down migration order
The down script removes indexes first, then drops tables, and finally removes columns in reverse order. This ordering prevents dependency errors and mirrors SQLite's limited `ALTER TABLE DROP COLUMN` behaviour implemented via table rebuilds in our migration harness.

## Snapshot updates
- Update `src-tauri/src/schema.sql` to mirror every change so new installs match the migrated database.
- `schema/family_members.json` or equivalent snapshots (if present) must add the new keys with nullable types; values default to `null` when omitted.

No data manipulation is performed in PR1; existing rows remain untouched until subsequent PRs populate the new fields.
