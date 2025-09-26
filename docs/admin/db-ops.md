# Admin Runbook: Database Operations

This runbook documents the command-line interfaces that mirror the UI recovery actions. All commands are executed from the project root unless noted. Example outputs are truncated for clarity.

## Health Status

```bash
$ tauri-cli db status
```

Expected output:

```json
{
  "status": "ok",
  "generated_at": "2025-02-10T19:47:21Z",
  "checks": [
    { "name": "integrity_check", "passed": true, "duration_ms": 142 }
  ]
}
```

Exit codes:

* `0` – Health report retrieved.
* `64` – Report unavailable. Investigate filesystem access and retry.

## Backups

Create a snapshot:

```bash
$ tauri-cli db backup
```

Example output:

```json
{
  "sqlite_path": "/backups/db-2025-02-10.sqlite3",
  "db_size_bytes": 143285248,
  "retention": 5
}
```

List existing backups:

```bash
$ tauri-cli db backup --list
```

Reveal the latest backup on disk:

```bash
$ tauri-cli db backup --reveal latest
```

Exit codes:

* `0` – Snapshot created.
* `65` – Insufficient disk. Free space or update retention.
* `66` – Permission denied. Run with elevated privileges or adjust folder ACLs.

## Repair

Run a standard repair:

```bash
$ tauri-cli db repair
```

The command streams JSON progress events. Final summary:

```json
{
  "success": true,
  "duration_ms": 8432,
  "steps": [
    { "step": "backup", "status": "success" },
    { "step": "swap", "status": "success" }
  ],
  "backup_sqlite_path": "/backups/db-2025-02-10.sqlite3"
}
```

Exit codes:

* `0` – Repair completed.
* `70` – Repair failed (review `error` block in JSON output).

## Hard Repair

Use hard repair to rebuild tables one by one:

```bash
$ tauri-cli db hard-repair
```

Expected summary:

```json
{
  "outcome": "partial",
  "recovery": {
    "tables": {
      "events": { "adds": 1240, "failed": 2 }
    }
  },
  "report_path": "/reports/hard-repair-2025-02-10.json"
}
```

Exit codes:

* `0` – Hard repair finished (even with warnings).
* `70` – Hard repair aborted. Check the report and console output.

## Export

Create a portable bundle:

```bash
$ tauri-cli db export --out ./exports
```

Output:

```json
{
  "directory": "./exports/arklowdun-2025-02-10",
  "manifestPath": "./exports/arklowdun-2025-02-10/manifest.json",
  "verifyShPath": "./exports/arklowdun-2025-02-10/verify.sh"
}
```

## Import

Preview an import:

```bash
$ tauri-cli db import --bundle ./exports/arklowdun-2025-02-10 --mode merge --dry-run
```

Apply the plan:

```bash
$ tauri-cli db import --bundle ./exports/arklowdun-2025-02-10 --mode merge --apply
```

Import exit codes:

* `0` – Import applied successfully.
* `68` – Bundle schema mismatch.
* `69` – Validation failed. Inspect the generated report path.

## Reports

List available reports:

```bash
$ tauri-cli reports list
```

Show details for a specific report:

```bash
$ tauri-cli reports show hard-repair-2025-02-10.json
```

## Troubleshooting

* **Insufficient disk** – Backups and repairs require free space equal to the database size plus 20%. Clear temp files or mount additional storage. Commands exit with `65` (backup) or `70` (repair) when space is inadequate.
* **Permission denied** – Ensure the CLI runs with rights to the application directory and backup location. On Linux/macOS use `sudo`; on Windows launch an elevated shell.
* **Schema mismatch** – Import and hard repair may fail if the bundle was produced by an older schema. Regenerate the export after upgrading the app, or run database migrations before importing.

Always capture the JSON output and report files when escalating issues. The `context` block in error payloads contains stack traces and file paths required by engineering.
