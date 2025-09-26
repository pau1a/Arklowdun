# Operation Reports

Operation reports capture per-run metadata for critical safety and recovery workflows. All
reports are JSON artefacts written beneath the canonical app-data reports root:

```
$APPDATA/arklowdun/reports/<operation>/<yyyy>/<mm>/<operation>-<yyyymmdd>-<hhmmss>-<suffix>.json
```

The writer enforces atomic persistence (tempfile + fsync on file and parent directory) and clamps
POSIX permissions to `0600`. On Windows the artefacts inherit the parent directory ACLs because
there is no portable equivalent to POSIX mode bits. The latest 50 reports are retained per
operation; older files are removed deterministically once the quota is exceeded.

## Schema Overview

Each payload is validated against `schemas/report-v1.schema.json` and carries a `report_version`
and `schema_sha256` guard. Core fields:

| Field | Description |
| --- | --- |
| `id` | Stable identifier (`op-<yyyymmdd>-<hhmmss>-<suffix>`). |
| `op_id` | Human readable identifier prefixed with the operation name. |
| `operation` | One of `health`, `backup`, `repair`, `hard_repair`, `export`, `import`. |
| `started_at` / `finished_at` | RFC3339 timestamps (millisecond precision). `finished_at` must be ≥ `started_at`. |
| `elapsed_ms` | Milliseconds between `started_at` and `finished_at`. |
| `status` | `success`, `failed`, `partial`, or `skipped`. `failed` implies at least one error and `success` implies none. |
| `app_version` | Running app version. |
| `schema_version` | Current SQLite schema migration version. |
| `host_tz` | Host timezone label combining IANA identifier and numeric offset. |
| `correlation_id` | Optional caller-supplied token for cross-system reconciliation. |
| `details` | Operation-specific payload (see below). |
| `errors` | Structured errors; truncation adds `OPS_REPORT/TRUNCATED`. |

In debug builds, each serialized report is validated against `report-v1.schema.json` at runtime to
catch schema drift before shipping.

## Detail Contracts

The `details` object must include specific keys per operation. Keys `token`, `email`, `note_body`,
and `username` are blocked at the top level and within immediate child objects to prevent obvious
PII leakage.

| Operation | Required Keys | Notes |
| --- | --- | --- |
| `health` | `checks`, `offenders` | Arrays describing executed checks and any offending entities. |
| `backup` | `backup_path`, `manifest_path`, `size_bytes`, `sha256` | Paths are absolute; checksum is hexadecimal. |
| `repair` | `steps`, `outcome`, `backup_path` | `steps` enumerates actions, `outcome` summarises results. |
| `hard_repair` | `attempted`, `succeeded`, `failed`, `omissions_path` | Counts for table-level work plus path to omissions manifest. |
| `export` | `export_path`, `manifest_path`, `counts`, `hashes` | `counts`/`hashes` capture per-table metrics. |
| `import` | `mode`, `plan_counts`, `applied_counts`, `conflicts` | Plan/applied counts mirror CLI dry-run output; `conflicts` enumerates unresolved items. |

## Consumer Guidance

* CLI commands print `Report: <path>` after completion.
* UI surfaces should rely on `op_id`, `status`, `started_at`, and `finished_at` for summaries.
* Error arrays are stable; prefer code matching (`OPS_REPORT/TRUNCATED`) over free-form message parsing.

## Schema evolution checklist

Follow these steps when changing the schema:

1. Edit `schemas/report-v1.schema.json` with the new structure.
2. Recompute the schema hash and update `REPORT_SCHEMA_SHA256` (tests will fail until it matches).
3. Adjust fixtures/tests (including JSON Schema validation) to cover the new fields.
4. Bump `report_version` if the change breaks backwards compatibility.
5. Update this document (and any UI/CLI consumers) with the new detail contract.
