# Import Workflow Runbook

This runbook documents the supported ways to import an export bundle back into
Arklowdun. It covers the in-app flow, the CLI command, emitted telemetry, and
where to locate the generated evidence when troubleshooting.

## Bundle Expectations

Export bundles contain a `manifest.json`, deterministic `data/*.jsonl` payloads,
and any binary assets under `attachments/`. The import path requires:

- Schema hash in the manifest to match the live database schema.
- App version reported by the bundle to be at least
  `MIN_SUPPORTED_APP_VERSION` (currently `0.1.0`).
- Enough free disk space to copy the bundle contents and write the execution
  report. The validator measures the bundle size and compares it to available
  space on the target volume.
- SHA256 hashes for every payload and attachment file to match the manifest
  entries. Hash verification runs before any data is written to the database.

Validation failures abort the workflow with an explicit error describing the
failing check (version mismatch, missing file, hash mismatch, or insufficient
space).

## In-App Flow (Settings → Import data)

1. **Choose bundle.** The user selects a directory containing `manifest.json`.
   The panel stores the absolute path but does not start work yet.
2. **Run dry-run.** Clicking “Run dry-run” invokes `db_import_preview` which
   loads the bundle, performs validation, and builds a deterministic plan for
   either merge or replace mode. The UI renders:
   - Bundle size, number of data files, and attachments verified during
     validation.
   - Planned table adds/updates/skips plus any detected conflicts (with
     timestamps) for merge mode.
   - Planned attachment adds/updates/skips plus conflict reasons.
3. **Review plan.** The Import button remains disabled until a successful
   preview finishes. Users can toggle merge ↔ replace before running the dry-run
   to regenerate the plan.
4. **Execute import.** Clicking “Import” calls `db_import_execute` with the
   previously returned plan digest. The backend recomputes validation + plan,
   rejects execution if the digest changed (preventing drift), then streams
   progress events and applies the plan. When complete the UI shows applied
   counts, renders the execution report summaries, and enables “Reveal report”.
5. **Open report.** Successful executions expose the JSON report via a button
   (falls back to copying the path if `@tauri-apps/plugin-opener` is not
   available).

Errors during preview or execution surface as toasts and inline status messages.
The UI keeps the prior plan so users can retry after resolving the issue.

## CLI Usage (`arklowdun db import`)

The CLI wraps the same validator, planner, and executor used in-app.

```bash
# Dry-run (merge mode by default). Prints validation summary + plan JSON.
arklowdun db import --in /path/to/bundle --dry-run

# Replace mode execution. Prints applied counts and report path.
arklowdun db import --in /path/to/bundle --mode replace
```

Exit codes communicate outcome:

- `0` — dry-run or execution succeeded.
- `1` — validation failed (version mismatch, hash failure, missing assets,
  insufficient disk, etc.).
- `2` — execution failed after validation succeeded (plan drift, SQL error,
  attachment copy failure, etc.).

Reports are written next to the SQLite database (default
`<appDataDir>/reports/import_*.json`). The CLI prints the path on success.

## Progress Events & Logs

Import commands emit structured JSON events through the Tauri event bus so the
UI can display progress in real time:

- `import://started` — includes the resolved bundle path, selected mode, and the
  generated log file path.
- `import://progress` — raised for each stage transition (validation, planning,
  per-table import, attachment copy). Payloads include the step name and
  duration when finished.
- `import://done` — success terminal event with total duration and aggregate
  counts.
- `import://error` — failure terminal event with an error message/code.

Every run also writes an on-disk log under
`<appDataDir>/logs/import_YYYYMMDD_HHMMSS.log`. Retention is count-based and
configurable via the `IMPORT_LOG_RETENTION` environment variable. The log is
JSONL with the same payloads described above, making it suitable for attaching
as evidence when escalating bugs.

## Troubleshooting Checklist

1. **Validation error before execution**
   - Confirm the live app has not been upgraded/downgraded relative to the
     exported bundle.
   - Verify the bundle directory is complete (no missing `data/*.jsonl` or
     `attachments/` entries) and readable by the process.
   - Check free disk space on the volume that hosts the SQLite database and
     attachments root.
2. **Plan drift rejection**
   - Ensure no other process mutated the database or attachments between the
     dry-run and execution. Re-run preview immediately before execution to
     refresh the plan digest.
3. **Execution failure**
   - Inspect the emitted log (`logs/import_*.log`) and the generated JSON report
     under `reports/` for the specific table/attachment that failed.
   - Look for attachment hash mismatches, failed file copies (permissions), or
     SQL constraint violations.
4. **UI progress does not update**
   - Reload the Settings screen to re-subscribe to import events.
   - Verify the Tauri log for event emission errors (look for
     `import://` channels).

Escalate with the bundle path, selected mode, log file, and report JSON for any
unresolved issues.
