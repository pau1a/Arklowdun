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

| Field                   | Type    | Example | Description                                                                 |
| ----------------------- | ------- | ------- | --------------------------------------------------------------------------- |
| `pets_total`            | integer | `5`     | Count of active (non-deleted) pets.                                         |
| `pets_deleted`          | integer | `1`     | Count of soft-deleted pets (`deleted_at` not null).                         |
| `pet_medical_total`     | integer | `27`    | Total medical records for non-deleted pets.                                 |
| `pet_attachments_total` | integer | `8`     | Medical rows with a `relative_path` recorded.                               |
| `pet_attachments_missing` | integer | `2`   | Attachments that failed the latest `files_exists` probe.                    |
| `pet_thumbnails_built`  | integer | `6`     | Renderer-triggered thumbnail generations.                                   |
| `pet_thumbnails_cache_hits` | integer | `12` | Thumbnail fetches served from cache.                                        |
| `reminder_active_timers` | integer | `4`    | Current timers managed by the runtime scheduler.                            |
| `reminder_buckets`      | integer | `4`     | Unique `reminder_at` buckets currently registered.                          |
| `reminder_queue_depth`  | integer | `4`     | Total timers plus queued reminder batches awaiting scheduling.              |
| `last_24h_failures`     | integer | `2`     | Pets mutations that failed within the last 24 hours (tracks retry hot spots). |
| `missing_attachments`   | array   | `[ ... ]` | Snapshot of unresolved attachment paths (see §4).                          |
| `failure_events`        | array   | `[ "2025-01-02T14:03:00.000Z" ]` | ISO timestamps used to compute `last_24h_failures`. |

All counts are emitted in the `diagnostics.json` bundle under:

```json
"pets": {
  "pets_total": 5,
  "pets_deleted": 1,
  "pet_medical_total": 27,
  "pet_attachments_total": 8,
  "pet_attachments_missing": 2,
  "pet_thumbnails_built": 6,
  "pet_thumbnails_cache_hits": 12,
  "reminder_active_timers": 4,
  "reminder_buckets": 4,
  "reminder_queue_depth": 4,
  "last_24h_failures": 2,
  "failure_events": ["2025-01-02T14:03:00.000Z"],
  "missing_attachments": [
    { "household_id": "hh-1", "category": "pet_medical", "relative_path": "fido/vaccine.pdf" }
  ]
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

`perf.pets.timing` captures renderer and scheduler latency samples. Every entry includes `duration_ms` and an `ok` flag; when `ok`
is `false` the event also carries `code` and `crash_id` from `normalizeError`.

| Name                     | Trigger                                              | Additional fields                                        |
| ------------------------ | ---------------------------------------------------- | -------------------------------------------------------- |
| `list.load`              | `petsRepo.list` resolves during view refresh         | `count`, `household_id`                                  |
| `list.window_render`     | Virtualised list renders a window                    | `rows_rendered`, `from_idx`, `to_idx`                    |
| `list.create`            | Inline create flow completes                         | `household_id`, `pet_id`                                 |
| `list.update`            | Inline rename/save finishes                          | `household_id`, `pet_id`                                 |
| `detail.open`            | Detail drawer mounts                                 | `household_id`, `pet_id`                                 |
| `detail.medical_create`  | Medical record successfully persisted                | `household_id`, `pet_id`, `record_id`                    |
| `detail.medical_delete`  | Medical record removed                               | `household_id`, `pet_id`, `record_id`                    |
| `detail.attach_open`     | Attachment open command (soft failures keep `ok:0`)  | `household_id`, `pet_id`, `record_id`, `result`          |
| `detail.attach_reveal`   | Reveal-in-finder action                              | `household_id`, `pet_id`, `record_id`, `result`          |
| `detail.fix_path`        | Broken attachment path replaced                      | `household_id`, `pet_id`, `medical_id`, `outcome`        |
| `reminders.schedule_many`| Reminder batches queued                              | `household_id`, `scheduled`, `queue_depth`               |
| `reminders.fire`         | Notification callback executed                       | `household_id`, `pet_id`, `medical_id`                   |
| `reminders.cancel_all`   | Scheduler cleared (view teardown/household switch)   | `household_id`, `canceled`                               |

Mutation failures emit `ui.pets.mutation_fail` with `op`, `code`, `crash_id`, and the relevant `household_id` / entity identifiers.
Legacy success/failure logs (`ui.pets.medical_*`, `ui.pets.attach_*`, `ui.pets.reminder_*`) remain for human-readable breadcrumbs.
All entries appear in the rotating log file (`~/Library/Logs/Arklowdun/arklowdun.log`) as structured JSON objects.

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

### 6.2 Attachment validation & repair telemetry

* Validates every `pet_medical.relative_path` against the vault root allowlist and records the aggregate counters described above.
* During diagnostics the collector replays the cached “missing attachment” set recorded by the renderer so support can spot stale rows without forcing a fresh disk scan.
* Logs anomalies with `code: PATH_OUT_OF_VAULT` plus the friendly toast copy used in the UI (`presentFsError`). The repair flow adds explicit audit events (`ui.pets.attachment_fix_opened` / `_fixed`) so support can confirm that users resolved issues.

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
    "pets_deleted": 1,
    "pet_medical_total": 27,
    "pet_attachments_total": 8,
    "pet_attachments_missing": 2,
    "pet_thumbnails_built": 6,
    "pet_thumbnails_cache_hits": 12,
    "reminder_active_timers": 4,
    "reminder_buckets": 4,
    "reminder_queue_depth": 4,
    "last_24h_failures": 2,
    "failure_events": [
      "2025-01-02T14:03:00.000Z"
    ],
    "missing_attachments": [
      {
        "household_id": "hh-1",
        "category": "pet_medical",
        "relative_path": "fido/vaccine.pdf"
      }
    ]
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
