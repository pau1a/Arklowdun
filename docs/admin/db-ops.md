# Database Health Operations

Operators can run the bundled CLI to check SQLite integrity before taking any
remediation steps. The `arklowdun db status` command executes the same checks
the desktop app runs on launch and produces the report that powers the in-app
health banner and “View details” drawer. See the [DB health UI
spec](../v1-beta-gate/03-data-safety/PR01.md#ui-surface) for the banner/drawer
copy and [phase overview](../v1-beta-gate/03-data-safety/README.md#a-detect-db-health)
for the wider workflow.

## Running the status command

```bash
arklowdun db status
```

The CLI opens the live application database (creating it if missing) and runs
`PRAGMA quick_check`, `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, and
storage sanity checks (journal mode, page size, WAL inspection/self-heal). The
result is printed as a table that mirrors the drawer in the app.

### Example: healthy database

```
Database health report
Status       : ok
Schema hash  : 6f9f87c72c2f4b5aacdb1a3ce3e5b5f7b6789f3c2648c1f513fa09eace0a8ef9
App version  : 0.1.0
Generated at : 2024-03-15T18:21:09.114Z

Checks:
Check                Passed     Duration (ms)  Details
quick_check          yes                   3  -
integrity_check      yes                   6  -
foreign_key_check    yes                   4  -
storage_sanity       yes                  12  journal_mode=wal; page_size=4096; wal header healed after checkpoint

Offenders: none
```

### Machine-readable output

Use `--json` when scripting or collecting machine-readable evidence:

```bash
arklowdun db status --json
```

Sample payload (truncated for brevity):

```json
{
  "status": "ok",
  "checks": [
    {
      "name": "quick_check",
      "passed": true,
      "duration_ms": 3
    },
    {
      "name": "integrity_check",
      "passed": true,
      "duration_ms": 6
    },
    {
      "name": "foreign_key_check",
      "passed": true,
      "duration_ms": 4
    },
    {
      "name": "storage_sanity",
      "passed": true,
      "duration_ms": 12,
      "details": "journal_mode=wal; page_size=4096; wal header healed after checkpoint"
    }
  ],
  "offenders": [],
  "schema_hash": "6f9f87c72c2f4b5aacdb1a3ce3e5b5f7b6789f3c2648c1f513fa09eace0a8ef9",
  "app_version": "0.1.0",
  "generated_at": "2024-03-15T18:21:09.114Z"
}
```

Consumers can diff successive reports to confirm when a repair job fixes a
previously failing check or to archive `schema_hash`/`app_version` for audit.

## Exit codes and unhealthy handling

`arklowdun db status` exits with status `0` when every check passes and `1` when
any check fails. Even on failure the report prints in full so operators can see
which checks tripped and which tables appear under **Offenders**. When the exit
code is non-zero the desktop app simultaneously shows the persistent health
banner, blocks write operations, and offers a “View details” drawer with the
same structured payload; use the UI flow for user-facing remediation guidance
and the CLI for automation, logging, or remote triage.

Re-run the command after repairs (guided or manual) to confirm the banner clears
and the CLI returns to exit code `0`.
