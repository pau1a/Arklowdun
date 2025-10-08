# Database

## Table definition
```sql
CREATE TABLE family_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birthday INTEGER,
  notes TEXT,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0
);
```
The table was introduced in the baseline migration (`migrations/0001_baseline.sql`) and the schema mirror (`schema.sql`) still matches that definition today.【F:migrations/0001_baseline.sql†L129-L139】【F:schema.sql†L115-L125】

### Constraints & indexes
- Foreign key: `household_id` cascades on delete and update into the owning household.【F:schema.sql†L120-L120】
- Defaults / nullability: `name`, `household_id`, `created_at`, `updated_at`, and `position` are `NOT NULL`, with `position` defaulting to `0`; `birthday`, `notes`, and `deleted_at` are nullable.【F:schema.sql†L115-L125】
- Ordering index: a partial unique index enforces `(household_id, position)` uniqueness for active rows (`deleted_at IS NULL`).【F:schema.sql†L273-L274】
- Secondary index: `(household_id, updated_at)` supports ordered lookups during sync/refresh operations.【F:schema.sql†L273-L274】
- No triggers or views reference `family_members`; the schema file lists only the table and these two indexes with no additional database objects for the domain.【F:schema.sql†L115-L274】

### Lifecycle behaviour
- Reads always filter on `deleted_at IS NULL` via `repo::list_active` / `get_active`, which also enforce household scoping and stable ordering (`position, created_at, id`).【F:src-tauri/src/repo.rs†L165-L239】
- Soft deletion sets `deleted_at`, bumps `updated_at`, and renumbers positions inside a transaction; restore clears `deleted_at`, adds `1_000_000` to the stored position, and then recomputes sequential positions via `renumber_positions`.【F:src-tauri/src/repo.rs†L300-L339】【F:src-tauri/src/repo.rs†L450-L506】
- Inserts and updates stamp `created_at`/`updated_at` in the command helper before writing to SQLite, so rows always carry timestamps.【F:src-tauri/src/commands.rs†L695-L734】

### Migration lineage & ownership
- The migration lives in `migrations/0001_baseline.sql`, alongside other legacy tables. There are no later migrations that alter `family_members`; schema evolution has not touched the table since the baseline file.【F:migrations/0001_baseline.sql†L90-L160】
- No other table carries a foreign key to `family_members`; related domains (pets, bills, notes, etc.) remain household-scoped only.【F:schema.sql†L115-L274】
- Household cascade deletes include `family_members` in the phase list, ensuring vacuum/hard-repair sweeps the table with the rest of the tenant data.【F:src-tauri/src/household.rs†L380-L418】

### SQLite runtime configuration
The SQLite pool enforces `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, sets a 5 s busy timeout, and enables WAL autocheckpointing when connections are established; `log_effective_pragmas` records the effective values for diagnostics.【F:src-tauri/src/db.rs†L139-L219】

## member_attachments

```sql
CREATE TABLE member_attachments (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  title TEXT,
  root_key TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_hint TEXT,
  added_at INTEGER NOT NULL,
  FOREIGN KEY(household_id) REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY(member_id) REFERENCES family_members(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX idx_member_attachments_path
  ON member_attachments(household_id, root_key, relative_path);
CREATE INDEX idx_member_attachments_member
  ON member_attachments(member_id, added_at DESC);
```

- The unique index enforces one attachment per `(household_id, root_key, relative_path)` tuple.
- Vault integrity relies on `Vault::resolve` normalising and validating `root_key` and `relative_path` before inserts.
- Rows cascade-delete with both the owning household and member to avoid orphaned paths.
- `added_at` stores epoch milliseconds for ordering.

## member_renewals

```sql
CREATE TABLE member_renewals (
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
  FOREIGN KEY(household_id) REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY(member_id) REFERENCES family_members(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_member_renewals_house_kind
  ON member_renewals(household_id, kind, expires_at);
CREATE INDEX idx_member_renewals_member
  ON member_renewals(member_id, expires_at);
```

- Renewals always belong to a member within the same household; the repository layer enforces this before writes.
- Boolean values (`remind_on_expiry`) are stored as integers and normalised to `true`/`false` in IPC adapters.
- Offsets default to 30 days and must remain between 0 and 365 in PR2 validation.
- Ordering indexes support the IPC guarantees documented in `docs/family/ipc.md`.
