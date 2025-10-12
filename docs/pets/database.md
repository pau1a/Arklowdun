# Pets Database

### Purpose

This document describes the SQLite structures that back the Pets domain. It covers the table layouts, indexes, integrity rules, and validation artefacts that were exercised in Pets PR1.

---

## 1. Tables

### 1.1 `pets`

| Column        | Type    | Constraints                                                                 | Notes                                                      |
| ------------- | ------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `id`          | TEXT    | Primary key                                                                 | UUIDv7 generated in Rust.                                  |
| `name`        | TEXT    | `NOT NULL`                                                                  | Display name in the UI.                                    |
| `type`        | TEXT    | `NOT NULL`                                                                  | Species/breed descriptor (free-form text).                 |
| `household_id`| TEXT    | `NOT NULL`, `REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE`  | Keeps records scoped to a household; historical dumps may spell the table `household` or `households`, and the validation test accepts whichever exists. |
| `image_path`  | TEXT    | Nullable                                                                    | Vault-relative path to the pet’s photo stored under the `pet_image` attachment category. |
| `created_at`  | INTEGER | `NOT NULL`                                                                  | Millisecond epoch set at insert time.                      |
| `updated_at`  | INTEGER | `NOT NULL`                                                                  | Millisecond epoch refreshed on writes.                     |
| `deleted_at`  | INTEGER | Nullable                                                                    | Soft-delete marker; null when active.                      |
| `position`    | INTEGER | `NOT NULL DEFAULT 0`                                                        | Ordering slot for UI drag and drop.                        |

### 1.2 `pet_medical`

| Column         | Type    | Constraints                                                                 | Notes                                                                                     |
| -------------- | ------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `id`           | TEXT    | Primary key                                                                 | UUIDv7 generated in Rust.                                                                  |
| `pet_id`       | TEXT    | `NOT NULL`, `REFERENCES pets(id) ON DELETE CASCADE ON UPDATE CASCADE`       | Cascades away whenever the parent pet is deleted.                                         |
| `date`         | INTEGER | `NOT NULL`                                                                  | Millisecond epoch for the medical event (local-noon normalised in the UI).                |
| `description`  | TEXT    | `NOT NULL`                                                                  | User supplied summary of the treatment/visit.                                             |
| `document`     | TEXT    | Nullable                                                                    | Optional legacy attachment pointer, retained for backwards compatibility.                 |
| `reminder`     | INTEGER | Nullable                                                                    | Millisecond epoch for follow-up notifications.                                            |
| `household_id` | TEXT    | `NOT NULL`, `REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE`  | Matches the parent pet’s household; validation tolerates either `household` or `households` table names in the FK target.                                   |
| `created_at`   | INTEGER | `NOT NULL`                                                                  | Millisecond epoch set during insert.                                                       |
| `updated_at`   | INTEGER | `NOT NULL`                                                                  | Millisecond epoch refreshed on mutation.                                                  |
| `deleted_at`   | INTEGER | Nullable                                                                    | Soft-delete marker.                                                                         |
| `root_key`     | TEXT    | Nullable                                                                    | Vault root identifier when an attachment exists.                                           |
| `relative_path`| TEXT    | Nullable                                                                    | Vault-relative path for attachments; enforced unique per household/category when present. |
| `category`     | TEXT    | `NOT NULL DEFAULT 'pet_medical'`, `CHECK (category IN ('bills','policies','property_documents','inventory_items','pet_medical','vehicles','vehicle_maintenance','notes','misc'))` | Keeps attachment rows aligned with the shared vault taxonomy.                              |

---

## 2. Indexes

The schema ships with the following indexes relevant to the Pets domain:

| Name                                         | Definition / Purpose |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `pets_household_position_idx`                | Partial **unique** index on `(household_id, position)` constrained to `deleted_at IS NULL`; preserves per-household ordering. |
| `pets_household_updated_idx`                 | Tracks `(household_id, updated_at)` to accelerate change feeds. |
| `pets_household_image_idx`                   | Indexes `(household_id, image_path)` for vault lookups and repair scanning. |
| `pet_medical_pet_date_idx`                   | Orders medical history by `(pet_id, date)` for timeline rendering. |
| `pet_medical_household_updated_idx`          | Drives household scoped syncs on medical records. |
| `pet_medical_household_category_path_idx`    | Partial **unique** index on `(household_id, category, relative_path)` constrained to `deleted_at IS NULL AND relative_path IS NOT NULL`; prevents duplicate attachment slots. |

All index names, uniqueness flags, and partial `WHERE` predicates are asserted via `PRAGMA index_list` queries and matching `sqlite_master.sql` text in `tests/pets-schema.test.ts`.

---

## 3. Integrity guarantees

* **Foreign keys** – `PRAGMA foreign_key_check` returns zero violations after inserting sample pets and medical records, and it remains clean after deleting the parent pet. This verifies that `pet_medical` honours the `ON DELETE CASCADE` contract and that household scoping is enforced for both tables.
* **Database consistency** – `PRAGMA integrity_check` returns `ok` before and after cascading deletes, confirming there are no hidden corruption states.
* **Capability probe** – The `db_has_pet_columns` IPC command checks for the presence of the `pets` table and the required scalar columns (`name`, `type`). With the validated schema the probe returns `true`, allowing the capability log (`caps:probe`) to advertise `pets_cols=true` during startup.

These assertions are codified in `tests/pets-schema.test.ts`, which uses an in-memory SQLite database initialised from `src-tauri/schema.sql`.

---

## 4. Schema quirks

* The UI layers may attach an in-memory `medical` array to `Pet` models, but this field is populated through separate queries – the `pets` table itself only stores the scalar columns listed above.
* The legacy `document` column on `pet_medical` remains nullable to support older exports; new attachments exclusively use `root_key` + `relative_path`.
* Pet profile photos live under the `pet_image` vault category; `image_path` stores the sanitised relative location (or `NULL` when no photo is present).

---

## 5. Verification artefacts

| Artefact                               | Description                                                    |
| -------------------------------------- | -------------------------------------------------------------- |
| `tests/pets-schema.test.ts`            | Node-based test suite that checks schema text, indexes, and cascades from a clean database image. |
| `src/models.ts`                        | Updated TypeScript interfaces for `Pet` and `PetMedicalRecord`, matching the column names, nullability, and defaulted category enforced in SQL. |
| `docs/pets/plan/pr1.md`                | Acceptance checklist updated with links to the automated evidence captured in this PR. |

---

**Status:** Schema validated during Pets PR1.
**Scope:** Structural documentation for `pets` and `pet_medical` tables, covering constraints, indexes, and verification coverage.
**File:** `/docs/pets/database.md`

---
