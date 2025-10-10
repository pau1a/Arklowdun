# Pets PR1 – Schema & Integrity Validation

### Objective

PR1 confirms that the **Pets** and **Pet Medical** tables are present, structurally correct, and fully operational across all supported platforms (macOS primary; Windows and Linux secondary).
No new features or UI changes are introduced at this stage — the goal is *schema validation, migrations confirmation, and referential integrity enforcement.*

---

## 1. Scope & Intent

This PR ensures that the baseline schema required for the Pets domain:

* Exists and migrates cleanly from a blank database,
* Passes all integrity and cascade checks,
* Is referenced by working IPC commands in the backend,
* Matches TypeScript model definitions (name, type, nullability, and category).

The schema under review comprises:

* `pets`
* `pet_medical`

Both tables were introduced in `0001_baseline.sql` and upgraded by `0023_vault_categories.up.sql`.

No UI, reminder, or diagnostics logic is within scope here.

---

## 2. Key deliverables

| Deliverable                   | Description                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| **Schema parity report**      | Extract `CREATE TABLE` definitions for `pets`/`pet_medical` from both schema files, ensure they are identical, and confirm required constraints (FKs, defaults, category `CHECK`). |
| **Index name parity confirmed** | Compare the Pets index set (`pets_household_position_idx`, `pets_household_updated_idx`, `pet_medical_household_category_path_idx`, etc.) between schema sources. |
| **Migration test pass**       | Run `cargo test --package arklowdun --test migrate_from_zero -- --ignored migrate_pets_from_zero`. |
| **Foreign-key cascade proof** | Confirm `ON DELETE CASCADE` from `pets` → `pet_medical` works.                            |
| **Integrity verification**    | Run `PRAGMA foreign_key_check` and `PRAGMA integrity_check` as part of automated suite.   |
| **Capability probe**          | Ensure `db_has_pet_columns` returns `true` during startup and logs under `caps:probe`.    |
| **Type alignment audit**      | Cross-verify `Pet` and `PetMedicalRecord` TS interfaces against SQL columns and defaults. |

---

## 3. Detailed tasks

### 3.1 Migration replay

Perform migration sequencing from zero using existing framework. The CI container lacks the system `glib-2.0` package required by Tauri, so `cargo test --package arklowdun --test migrate_from_zero -- --ignored migrate_pets_from_zero` currently exits with `pkg-config` errors. The fallback validation for this PR is `tests/pets-schema.test.ts`, which initialises an in-memory SQLite database from `src-tauri/schema.sql` and exercises the schema without compiling the full app. The migration test should be rerun on a workstation with GTK dependencies installed.

### 3.2 Schema checksum

Extract the Pets DDL from both `schema.sql` and `src-tauri/schema.sql` and ensure the statements stay in sync. `tests/pets-schema.test.ts` now normalises whitespace, compares the two sources directly, and asserts the presence of the household foreign keys, defaulted `position`, and the vault category `CHECK` list.

### 3.3 Integrity enforcement

Run PRAGMA-based checks:

```sql
PRAGMA foreign_key_check;
PRAGMA integrity_check;
```

Both must return `ok`.

### 3.4 Cascade test

1. Insert a pet with `id='pet_001'`.
2. Insert three `pet_medical` rows referencing it.
3. DELETE FROM pets WHERE id='pet_001'.
4. Verify all child rows are gone:

   ```sql
   SELECT COUNT(*) FROM pet_medical WHERE pet_id='pet_001';
   ```

   Expected: `0`.

### 3.5 Capability probe

Run capability detection during startup:

```
[debug] caps:probe { pets_cols: true }
```

If false, mark failure — indicates migration not applied or schema mismatch.

### 3.6 TS model verification

Confirm that TypeScript model definitions correspond exactly to SQL columns:

| Field             | TS Type                   | SQL Type                                      | Match |
| ----------------- | ------------------------- | --------------------------------------------- | ----- |
| `id`              | `string`                  | TEXT (primary key)                            | ✅     |
| `name`            | `string`                  | TEXT NOT NULL                                 | ✅     |
| `type`            | `string`                  | TEXT NOT NULL                                 | ✅     |
| `household_id`    | `string`                  | TEXT NOT NULL (FK → household)                | ✅     |
| `created_at`      | `number`                  | INTEGER NOT NULL                              | ✅     |
| `updated_at`      | `number`                  | INTEGER NOT NULL                              | ✅     |
| `deleted_at`      | `number \| null \| undefined` | INTEGER nullable                               | ✅     |
| `position`        | `number`                  | INTEGER NOT NULL DEFAULT 0                    | ✅     |
| `medical` (UI)    | `PetMedicalRecord[]?`     | Derived (not persisted)                       | ✅     |
| `relative_path`   | `string \| null \| undefined` | TEXT nullable                                   | ✅     |
| `category`        | `'pet_medical'`           | TEXT NOT NULL DEFAULT 'pet_medical' + CHECK   | ✅     |
| `reminder`        | `number \| null \| undefined` | INTEGER nullable                               | ✅     |
| `document`        | `string \| null \| undefined` | TEXT nullable                                   | ✅     |

Schema quirks (e.g. `medical` being a derived field) are now recorded explicitly in `/docs/pets/database.md`.

---

## 4. Acceptance checklist

| Condition                                  | Status | Evidence |
| ------------------------------------------ | ------ | -------- |
| All migrations apply cleanly from baseline | ⚠️     | `cargo test --package arklowdun --test migrate_from_zero -- --ignored migrate_pets_from_zero` (blocked: `glib-2.0` missing in container) |
| No foreign key or integrity violations     | ☑      | `tests/pets-schema.test.ts` (`PRAGMA foreign_key_check`, `integrity_check`) |
| Cascade deletes verified manually          | ☑      | `tests/pets-schema.test.ts` cascade scenario |
| Capability probe logs `pets_cols=true`     | ☑      | `db_has_pet_columns` code path reviewed; startup logs emit `caps:probe { pets_cols: true }` when schema present |
| TS model field names/types match schema    | ☑      | `src/models.ts` updated + documented in `/docs/pets/database.md` |
| Docs updated (`database.md`, `ipc.md`)     | ☑      | This PR updates both documents |
| PR merged to main branch post-review       | ☐      | Pending PR merge |

---

## 5. Out-of-scope items

* UI rendering (`PetsView`, `PetDetailView`)
* Reminder scheduling or runtime
* Vault/attachment guard validation
* Diagnostics counters
* Empty-state or styling
* IPC structured typing (handled in PR2)

---

## 6. Verification workflow

1. Run full migration sequence locally:

   ```bash
   npm run tauri dev -- --migrate-from-zero
   ```
2. Export schema:

   ```bash
   sqlite3 ~/Library/Application\ Support/com.paula.arklowdun/app.sqlite .schema > schema_dump.sql
   ```
3. Compare to reference SQL under `/schema.sql`.
4. Validate integrity via:

   ```bash
   sqlite3 app.sqlite "PRAGMA integrity_check;"
   ```
5. Observe startup logs:

   ```
   [info] caps:probe { pets_cols: true, attachments_supported: true }
   [info] migrations up to date (0026_cascade_checkpoints)
   ```
6. Capture logs for documentation:

   ```
   tail -n 20 ~/Library/Logs/Arklowdun/arklowdun.log | grep pets
   ```

---

## 7. Risks and mitigations

| Risk                                          | Mitigation                                                |
| --------------------------------------------- | --------------------------------------------------------- |
| Missing pets columns on upgrade from older DB | `tests/pets-schema.test.ts` asserts table definitions and indexes on a fresh schema dump. |
| Nullability mismatch (`relative_path`)        | Resolved in PR1 by updating `PetMedicalRecord` typing and documenting nullable attachment paths. |
| SQLite foreign_keys disabled accidentally     | Startup path already enables `PRAGMA foreign_keys=ON`; automated test reruns `PRAGMA foreign_key_check`. |
| Cascade regression in future migrations       | Cascade scenario encoded in `tests/pets-schema.test.ts`; rerun after every migration change. |

---

## 8. Documentation updates required in this PR

| File                    | Update                                                    |
| ----------------------- | --------------------------------------------------------- |
| `docs/pets/database.md` | Replaced legacy schema description with the validated structure and test references. |
| `docs/pets/ipc.md`      | Updated command inventory, payload examples, and validation evidence. |
| `docs/pets/plan/pr1.md` | This checklist annotated with outcomes and follow-up notes. |

---

## 9. Sign-off

| Role          | Name              | Responsibility                          |
| ------------- | ----------------- | --------------------------------------- |
| **Developer** | Ged McSneggle     | Migration replay and test validation.   |
| **Reviewer**  | Paula Livingstone | Schema audit, doc verification.         |
| **CI**        | Automated         | Migrations up/down test and PRAGMA run. |

---

**Status:** Draft – pending initial replay verification
**File:** `/docs/pets/plan/pr1.md`
**Version:** 1.0
**Scope:** Confirms database health, migration reproducibility, and schema-model alignment for the Pets domain.

---
