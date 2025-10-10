# Pets Database

### Purpose

This document defines the persistent data structures that support the Pets domain.
It describes the tables, columns, indexes, and constraints that govern pet and pet-medical information inside the Arklowdun SQLite database.
All Pets data are stored in the same `arklowdun.sqlite3` file as other household-scoped entities and share the same integrity guarantees, PRAGMAs, and write guards.

---

## 1. Tables

### 1.1 `pets`

Stores the primary record for each animal owned by a household.

```sql
CREATE TABLE pets (
    id              TEXT PRIMARY KEY,            -- UUIDv7 generated in Rust
    household_id    TEXT NOT NULL,               -- FK to households.id
    name            TEXT NOT NULL,
    type            TEXT,                        -- species or general type
    breed           TEXT,
    sex             TEXT,
    neutered        INTEGER DEFAULT 0,           -- boolean flag (0/1)
    colour          TEXT,
    markings        TEXT,
    dob             TEXT,                        -- ISO date string
    weight_kg       REAL,
    size_category   TEXT,
    microchip       TEXT UNIQUE,                 -- may be NULL but unique if present
    insurance_provider TEXT,
    insurance_policy   TEXT,
    vet_name        TEXT,
    vet_contact     TEXT,
    avatar_relpath  TEXT,                        -- relative path under vault
    position        INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT,                        -- soft-delete marker
    FOREIGN KEY(household_id) REFERENCES households(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);
```

**Notes**

* `id` is a UUIDv7; no autoincrement integers are used.
* `household_id` scoping prevents orphaned pets when a household is deleted.
* `microchip` uses a `UNIQUE` constraint but accepts `NULL`, allowing multiple unchipped pets.
* Timestamps follow UTC and ISO-8601 string storage for cross-platform compatibility.

### 1.2 `pet_medical`

Holds dated medical entries, treatments, and reminder timestamps for each pet.

```sql
CREATE TABLE pet_medical (
    id               TEXT PRIMARY KEY,            -- UUIDv7
    household_id     TEXT NOT NULL,
    pet_id           TEXT NOT NULL,
    date             TEXT NOT NULL,               -- event date
    description      TEXT NOT NULL,
    diagnosis        TEXT,
    medication       TEXT,
    dosage           TEXT,
    allergy_flag     INTEGER DEFAULT 0,
    reminder_at      TEXT,                        -- UTC timestamp for next reminder
    root_key         TEXT DEFAULT 'appdata',
    relative_path    TEXT,                        -- may be NULL
    category         TEXT DEFAULT 'pet_medical' CHECK(category = 'pet_medical'),
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(household_id) REFERENCES households(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY(pet_id) REFERENCES pets(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);
```

**Notes**

* `household_id` is duplicated intentionally to allow efficient scoped queries without joining through `pets`.
* `reminder_at` drives the in-memory notification scheduler.
* `root_key` + `relative_path` identify the attachment location within the vault system.
* `category` is fixed to `"pet_medical"` and validated via a `CHECK` constraint to maintain consistency with vault categories.
* `description` and `diagnosis` accept arbitrary text; content is user-supplied.

---

## 2. Indexes

```sql
CREATE INDEX pets_household_position_idx
    ON pets (household_id, position, created_at, id);

CREATE INDEX pets_updated_idx
    ON pets (updated_at DESC);

CREATE INDEX pet_medical_pet_date_idx
    ON pet_medical (pet_id, date DESC, created_at DESC);

CREATE INDEX pet_medical_household_category_path_idx
    ON pet_medical (household_id, category, root_key, relative_path);
```

**Purpose**

* `pets_household_position_idx` supports deterministic ordering and UI reordering.
* `pets_updated_idx` helps sync and diagnostics queries sort by last change.
* `pet_medical_pet_date_idx` powers the descending timeline display in the detail view.
* `pet_medical_household_category_path_idx` enforces vault-path uniqueness per household and category.

---

## 3. Constraints and defaults

| Column          | Constraint                  | Description                                      |
| --------------- | --------------------------- | ------------------------------------------------ |
| `microchip`     | `UNIQUE` (nullable)         | Prevents duplicate chip numbers.                |
| `category`      | `CHECK(category = 'pet_medical')` | Keeps vault records typed.                  |
| `household_id`  | `FOREIGN KEY → households.id` | Enforces household scope.                     |
| `pet_id`        | `FOREIGN KEY → pets.id`        | Cascades medical records on pet delete.       |
| `deleted_at`    | Soft delete                 | Marks pets hidden from normal queries.          |
| `position`      | `DEFAULT 0`                 | Starting sort order for new entries.            |

---

## 4. Relationships

```
households 1 ────► N pets 1 ────► N pet_medical
```

* Deleting a household cascades to delete its pets and all related medical records.
* Deleting a pet cascades to delete only its own medical records.
* Attachments in the vault are referenced from `pet_medical.relative_path` but are not cascaded automatically; vault repair handles cleanup.
* Every `pet_medical` row carries the same `household_id` as its parent pet, ensuring fast scoped queries without joins.

---

## 5. Data lifecycle

| Stage   | Operation                                       | Mechanism                                      |
| ------- | ----------------------------------------------- | ---------------------------------------------- |
| Create  | Insert pet → optional medical rows → schedule reminders | IPC `pets_create`, `pet_medical_create`. |
| Update  | Patch mutable fields; bump `updated_at`          | IPC `pets_update`, `pet_medical_update`.       |
| Delete  | Soft delete pet; cascade hard delete medicals    | IPC `pets_delete`; FK cascade for medicals.    |
| Restore | Recreate pet with previous ID                    | Handled by app logic; no dedicated restore endpoint yet. |
| Vacuum  | Optional via household vacuum                    | Compacts deleted rows when user runs repair.   |

---

## 6. Query conventions

**List pets by household**

```sql
SELECT * FROM pets
 WHERE household_id = :hid
 ORDER BY position, created_at, id;
```

**List medical history for a pet**

```sql
SELECT * FROM pet_medical
 WHERE household_id = :hid
   AND pet_id = :pid
 ORDER BY date DESC, created_at DESC;
```

**Find upcoming reminders**

```sql
SELECT pet_id, description, reminder_at
  FROM pet_medical
 WHERE household_id = :hid
   AND reminder_at IS NOT NULL
   AND reminder_at > datetime('now')
 ORDER BY reminder_at ASC;
```

**Attachment repair reference**

```sql
SELECT id, root_key, relative_path
  FROM pet_medical
 WHERE category = 'pet_medical'
   AND (relative_path IS NULL OR relative_path = '');
```

---

## 7. Integrity checks

At runtime, the storage health system executes:

```sql
PRAGMA foreign_key_check;
PRAGMA integrity_check;
```

* `storage_sanity` fails if any orphaned `pet_medical` rows or mismatched `household_id` values appear.
* A failed check blocks write operations and surfaces `DB_UNHEALTHY_WRITE_BLOCKED` in the UI banner.

---

## 8. Migration history

| Migration                   | Purpose                    | Key changes                                                                 |
| --------------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `0001_baseline.sql`         | Initial domain schema      | Created `pets` and `pet_medical` tables; basic indexes.                      |
| `0023_vault_categories.up.sql` | Vault category alignment | Added `category` column, created composite path index, removed legacy document fields. |
| `0026_cascade_checkpoints.up.sql` | Integrity checkpointing | No Pets schema changes but added health tracking for cascade repair.         |

Future migrations will track foreign-key updates and new columns but must preserve backward compatibility with existing pets data.

---

## 9. Referential behaviour

| Action            | Effect                                                 |
| ----------------- | ------------------------------------------------------ |
| Delete household  | Cascades to pets → cascades to `pet_medical`.          |
| Delete pet        | Cascades to its `pet_medical` rows only.               |
| Update household ID | Propagates automatically to child rows.              |
| Update pet ID     | Permitted only internally; handled through cascade update. |

All cascades are immediate; no deferred constraint behaviour is used.

---

## 10. Data volume and performance notes

* Expected scale per household: `< 100` pets, `< 1000` medical rows.
* WAL journaling (`synchronous=FULL`, `wal_autocheckpoint=1000`) ensures durability.
* Index selection keeps read latency below 2 ms for typical list queries.
* Medical history queries are bounded by `DESC` order and index use; no full scans expected under normal loads.
* `VACUUM` or `REINDEX` can be triggered via the household maintenance UI if file growth exceeds expectations.

---

## 11. Known quirks and gaps

* `relative_path` may be null but UI assumes a non-empty string, producing defensive fallbacks.
* Medical descriptions interpolate directly into HTML; sanitisation is a UI concern, not a DB rule.
* No triggers yet enforce timestamp consistency between `created_at` and `updated_at`.
* Reminder scheduler does not persist its state; `reminder_at` timestamps are re-read on view load.
* No partial-index support for overdue reminders; handled in memory.

---

## 12. Diagnostics references

When the diagnostics collector runs, it queries:

```sql
SELECT COUNT(*) AS pets_total FROM pets WHERE deleted_at IS NULL;
SELECT COUNT(*) AS medical_total FROM pet_medical;
```

and includes those counts in the health report under the family → pets section.

---

**Owner:** Ged McSneggle  
**Status:** Schema current as of migration `0026`  
**Scope:** Defines the persistent data model for the Pets domain
