# Pets Diagnostics

### Purpose

This document defines the **diagnostic and observability layer** for the Pets domain within Arklowdun.
It details how Pets contributes to system health reports, what counters are exposed, how logs record pet-related events, and how support teams collect and interpret diagnostic data during troubleshooting.
Everything here reflects current implementation (as of PR14 baseline), not future design goals.

---

## 1. Diagnostic philosophy

The diagnostics system in Arklowdun exists to:

* allow **safe, anonymised insight** into app state during user support;
* enable integrity verification and export for support bundles;
* surface **real-time health indicators** through the Settings → Recovery UI.

Pets integrates with this system purely through **structured counters and event logs**.
No personally identifying pet data (names, breeds, etc.) are exported in diagnostics bundles.

---

## 2. Data sources

Diagnostics pull from:

* **SQLite schema introspection:**
  Tables `pets` and `pet_medical` are queried for aggregate counts.
* **Vault category scan:**
  Ensures all `pet_medical` attachments reside under permitted vault roots.
* **Reminder runtime:**
  Reads `reminderScheduler.stats()` for active timers and reminder buckets.
* **Repo health hooks:**
  The `petsRepo` and `petMedicalRepo` emit `ui.repo.*` events that appear in structured logs.

---

## 3. Exported counters

During a diagnostics run (via Settings → Recovery → Export Diagnostics → “Yes, redact”), the backend emits the following Pets metrics:

| Field                         | Type    | Example | Description                                                       |
| ----------------------------- | ------- | ------- | ----------------------------------------------------------------- |
| `pets_total`                  | integer | `5`     | Count of active (non-deleted) pets.                               |
| `pets_deleted`                | integer | `1`     | Count of soft-deleted pets (`deleted_at` not null).               |
| `pet_medical_total`           | integer | `27`    | Count of all medical records for active pets.                     |
| `pet_medical_with_attachment` | integer | `8`     | Rows where `relative_path` is not null.                           |
| `pet_reminders_total`         | integer | `6`     | Count of future-dated `reminder_at` timestamps.                   |
| `pet_reminders_overdue`       | integer | `2`     | Count of reminders with `reminder_at < now()` but `date > now()`. |
| `pets_with_medical_history`   | integer | `4`     | Distinct pets with at least one medical row.                      |
| `pets_with_birthdate`         | integer | `3`     | Distinct pets where `dob` is not null.                            |
| `reminder_active_timers`      | integer | `4`     | Snapshot of timers returned by the runtime scheduler.             |
| `reminder_buckets`            | integer | `4`     | Unique `reminder_at` buckets currently registered.               |

All counts are emitted in the `diagnostics.json` bundle under:

```json
"pets": {
  "pets_total": 5,
  "pet_medical_total": 27,
  "pet_reminders_total": 6,
  "reminder_active_timers": 4,
  "reminder_buckets": 4
}
```

---

## 4. Redaction rules

Redaction occurs in **Python-based collectors** (same logic as Family).
For the Pets section:

* Names, breeds, and notes are replaced with `***` placeholders.
* Attachment paths are truncated to base filename only (e.g., `vaccine_card.pdf` → `***.pdf`).
* Dates remain unmodified, as they carry no direct identity risk.

If Python redaction fails or is unavailable, collectors revert to raw output under the `--raw --yes` flag, emitting unredacted JSON for local debugging only.

---

## 5. Log channels

### 5.1 UI logs

`src/PetsView.ts` and `src/PetDetailView.ts` emit structured logs through the shared `logUI` helper.

| Event                     | Level | Fields                                |
| ------------------------- | ----- | -------------------------------------- |
| `perf.pets.window_render` | info  | rows_rendered, from_idx, to_idx        |
| `pets.medical_added`      | info  | pet_id, description, date              |
| `pets.medical_deleted`    | warn  | pet_id, medical_id                     |
| `pets.reminder_scheduled` | info  | pet_id, delay_ms                       |
| `pets.reminder_fired`     | info  | pet_id, reminder_at                    |
`src/features/pets/reminderScheduler.ts` together with `PetsView`/`PetDetailView` emit structured logs through the shared
`logUI` helper.

| Event                               | Level | Fields                                                                    |
| ----------------------------------- | ----- | -------------------------------------------------------------------------- |
| `pets.list_loaded`                  | info  | count, duration_ms                                                        |
| `pets.pet_created`                  | info  | id, name, type                                                            |
| `pets.medical_added`                | info  | pet_id, description, date                                                 |
| `pets.medical_deleted`              | warn  | pet_id, medical_id                                                        |
| `ui.pets.reminder_scheduled`        | info  | key, pet_id, medical_id, reminder_at, delay_ms, household_id               |
| `ui.pets.reminder_fired`            | info  | key, pet_id, medical_id, reminder_at, elapsed_ms, household_id            |
| `ui.pets.reminder_canceled`         | info  | key, household_id                                                         |
| `ui.pets.reminder_catchup`          | info  | key, pet_id, medical_id, household_id                                     |
| `ui.pets.reminder_permission_denied`| warn  | household_id                                                              |

These entries appear in the rotating log file (`~/Library/Logs/Arklowdun/arklowdun.log`) as structured JSON objects.

### 5.2 Backend logs

`src-tauri/src/commands.rs` and `repo.rs` log lower-level SQL actions:

| Event                    | Level | Message                      |
| ------------------------ | ----- | ---------------------------- |
| `sql.pets.insert`        | debug | Insert row success/failure   |
| `sql.pet_medical.vacuum` | info  | Vacuum run for pet_medical   |
| `health.pets.check`      | warn  | Integrity violation detected |

---

## 6. Health checks

### 6.1 Foreign-key integrity

Executed as part of `ensure_db_writable()`:

```sql
PRAGMA foreign_key_check(pets);
PRAGMA foreign_key_check(pet_medical);
```

Any non-empty result marks health status as `Error: FOREIGN_KEY_VIOLATION`.

### 6.2 Attachment validation

* Validates every `pet_medical.relative_path` against vault root allowlist.
* Logs anomalies with `code: PATH_OUT_OF_VAULT`.

### 6.3 Reminder runtime audit

Diagnostics collection queries `reminderScheduler.stats()` and captures both `activeTimers` and `buckets`. Support staff compare these counts against `pet_medical` reminder rows to detect orphaned timers or missing notifications.

---

## 7. Recovery and support

From Settings → Recovery → “Diagnostics and Repair”:

1. The user selects **Export Diagnostics**.
2. A redacted JSON bundle is generated containing all domain sections (including Pets).
3. Support staff can inspect the `pets` section for:

   * record counts,
   * reminder drift,
   * attachment path integrity.

If corruption is detected:

* The `household_vacuum` command can be run to rebuild indexes and clean orphaned pet records.
* If missing attachment files are detected, `vault_repair_scan` automatically re-links or logs them under “pet_medical missing”.

---

## 8. Example diagnostic output

```json
{
  "pets": {
    "pets_total": 5,
    "pet_medical_total": 27,
    "pet_reminders_total": 6,
    "pet_reminders_overdue": 2,
    "pet_medical_with_attachment": 8,
    "pets_with_birthdate": 3,
    "reminder_active_timers": 4,
    "reminder_buckets": 4
  },
  "caps": {
    "pets_cols": true
  },
  "health": {
    "db": "OK",
    "vault": "OK"
  }
}
```

---

## 9. Operator notes

| Tool                     | Purpose                               | Location             |
| ------------------------ | ------------------------------------- | -------------------- |
| `collect_diagnostics.sh` | Collects raw bundle with pets counts. | `scripts/`           |
| `diagnostics-redact.py`  | Performs field redaction.             | `scripts/`           |
| `diagnostics.md`         | Support doc referencing this section. | `docs/support/`      |
| `grep pets`              | Quick filter for pet-related logs.    | Terminal log triage. |

Logs can be compressed and shared as `.zip` from the same menu.

---

## 10. Known limitations

* Pets counters are **not individually unit tested** in diagnostics tests.
* Reminder runtime stats represent the current renderer session only; separate renderer windows report their own counts.
* Missing Python interpreter disables redaction and falls back to raw diagnostics.
* No anomaly detection yet for duplicate microchip IDs or null date entries.
* UI log timestamps rely on system clock, not monotonic counter.
* Diagnostic exports are single snapshot only—no incremental deltas.

---

**Owner:** Ged McSneggle
**Status:** Active and verified with PR3 reminder scheduler instrumentation (macOS-only diagnostics)
**Scope:** Defines diagnostic counters, log behaviour, and recovery workflow for Pets domain in Arklowdun

---
