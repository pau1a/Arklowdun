# Family logging model (PR3)

Family PR3 introduces structured logging across the Family backend commands and renderer interactions. All log lines share a consistent JSON envelope written through `tracing` (Rust) or `logUI` (TypeScript).

## Envelope schema

| Field | Type | Notes |
| --- | --- | --- |
| `ts` | string (ISO 8601) | Automatically produced by the logging sink. |
| `level` | enum (`TRACE` `DEBUG` `INFO` `WARN` `ERROR`) | Severity classification. |
| `area` | string | Always `"family"` for PR3 events. |
| `cmd` | string | IPC command name (`family_members_update`) or renderer event (`ui.family.drawer.save`). |
| `household_id` | string (optional) | Household scope for the action. |
| `member_id` | string (optional) | Target family member when applicable. |
| `duration_ms` | integer (optional) | Milliseconds elapsed between entry and completion. |
| `details` | object | Additional metadata (row counts, messages, identifiers). |

### Sample entries

```json
{
  "ts": "2025-10-09T12:43:17.512Z",
  "level": "INFO",
  "area": "family",
  "cmd": "family_members_update",
  "household_id": "hh-1",
  "member_id": "mem-1",
  "duration_ms": 23,
  "details": {
    "rows": 1,
    "message": "family member updated"
  }
}
```

```json
{
  "ts": "2025-10-09T12:43:17.984Z",
  "level": "INFO",
  "area": "family",
  "cmd": "ui.family.drawer.save",
  "details": {
    "member_id": "mem-1",
    "duration_ms": 87
  }
}
```

## Backend emission points

* All `family_members_*` IPC handlers create a scoped logger that records:
  * `DEBUG` entry (`cmd = family_members_*`, identifiers populated when available).
  * `INFO` completion with row counts and summary message.
  * `WARN` on validation or database-health failures (for example `DB_UNHEALTHY – write blocked`).
  * `ERROR` for unexpected faults (SQL errors, crash IDs, etc.).
* Attachment and renewal commands (`member_attachments_*`, `member_renewals_*`) follow the same pattern.
* Guard failures inside the generated IPC wrappers produce warn logs before returning the structured `AppError`.

## Frontend emission points

* `FamilyView` logs lifecycle stages through the injected `logUI` helper:
  * Household list loads (`ui.family.list.load.start/complete`).
  * Member creation attempts (`ui.family.create.*`).
  * Drawer saves and autosaves (`ui.family.drawer.save`, `ui.family.drawer.autosave.*`).
* Repository helpers emit telemetry for attachment and renewal flows under `ui.family.attachments.*` and `ui.family.renewals.*`.
* Renderer logs invoke the `family_ui_log` Tauri command through `logUI`, so the UI shares the same tracing sinks as the backend (falling back to a JSON `console.log` only when the bridge is unavailable).

## Log persistence

* Both stdout and the rotating file sink (`<app-data>/logs/arklowdun.log`) receive the JSON lines emitted via `family_ui_log`. During tests the standalone subscriber writes to an in-memory buffer to allow assertions.

## Verification checklist

* ✅ `family_members_*` commands emit entry and completion logs. See `family_logging.rs` tests for coverage.
* ✅ Guard failures (database unhealthy, maintenance) surface WARN logs with contextual details.
* ✅ Renderer interactions generate `ui.family.*` events exactly once per user action (verified by `tests/family-logging.test.ts`).
* ✅ Attachment and renewal UI helpers log start, completion, and error states.

## Known omissions

* Field redaction is deferred to a future PR; current logs include the identifiers supplied by the commands.
* No sampling is applied; high-frequency UI warnings should aggregate via `details.count` if necessary in follow-up work.
