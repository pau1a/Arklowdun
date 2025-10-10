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
| **Schema parity report**      | Compare live SQLite schema against `schema.sql`.                                          |
| **Migration test pass**       | Run `cargo test --package arklowdun --test migrations` to verify clean up/down cycle.     |
| **Foreign-key cascade proof** | Confirm `ON DELETE CASCADE` from `pets` → `pet_medical` works.                            |
| **Integrity verification**    | Run `PRAGMA foreign_key_check` and `PRAGMA integrity_check` as part of automated suite.   |
| **Capability probe**          | Ensure `db_has_pet_columns` returns `true` during startup and logs under `caps:probe`.    |
| **Type alignment audit**      | Cross-verify `Pet` and `PetMedicalRecord` TS interfaces against SQL columns and defaults. |

---

## 3. Detailed tasks

### 3.1 Migration replay

Perform migration sequencing from zero using existing framework:

```bash
cargo run --bin migrate_from_zero -- --verify pets
```

Expected output:

* Tables `pets` and `pet_medical` created in correct order.
* Indexes present:

  * `pets_household_position_idx`
  * `pet_medical_pet_date_idx`
  * `pet_medical_household_category_path_idx`

### 3.2 Schema checksum

Compute deterministic checksum against baseline schema:

```bash
sqlite3 app.sqlite .schema | sha256sum > /tmp/schema_hash.txt
```

Compare to canonical hash stored in `/tests/schema_hashes/pets.txt`.

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

| Field           | TS Type   | SQL Type        | Match                                              |
| --------------- | --------- | --------------- | -------------------------------------------------- |
| `id`            | `string`  | TEXT            | ✅                                                  |
| `name`          | `string`  | TEXT            | ✅                                                  |
| `type`          | `string`  | TEXT            | ✅                                                  |
| `position`      | `number`  | INTEGER         | ✅                                                  |
| `deleted_at`    | `string?` | TEXT            | ✅                                                  |
| `relative_path` | `string`  | TEXT (nullable) | ⚠ mismatch — code enforces required; note for PR2. |

All mismatches must be logged in `/docs/pets/database.md` under “Schema quirks”.

---

## 4. Acceptance checklist

| Condition                                  | Status | Evidence                       |
| ------------------------------------------ | ------ | ------------------------------ |
| All migrations apply cleanly from baseline | ☐      | `cargo test migrations` output |
| No foreign key or integrity violations     | ☐      | PRAGMA results                 |
| Cascade deletes verified manually          | ☐      | SQL proof                      |
| Capability probe logs `pets_cols=true`     | ☐      | App startup log                |
| TS model field names/types match schema    | ☐      | Manual audit record            |
| Docs updated (`database.md`, `ipc.md`)     | ☐      | Commit diff                    |
| PR merged to main branch post-review       | ☐      | PR # reference                 |

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
| Missing pets columns on upgrade from older DB | Migrate_from_zero test ensures correct baseline.          |
| Nullability mismatch (`relative_path`)        | Noted and deferred to PR2 contract enforcement.           |
| SQLite foreign_keys disabled accidentally     | Verify PRAGMA foreign_keys=ON in startup script.          |
| Cascade regression in test harness            | Covered by Rust integration tests (test_pets_cascade.rs). |

---

## 8. Documentation updates required in this PR

| File                          | Update                                   |
| ----------------------------- | ---------------------------------------- |
| `docs/pets/database.md`       | Add verified schema snapshot and hash.   |
| `docs/pets/ipc.md`            | Mark IPC schema presence as “Available”. |
| `docs/pets/plan/checklist.md` | Tick PR1 section once merged.            |
| `CHANGELOG.md`                | Add “PR1 – Pets schema validated”.       |

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
