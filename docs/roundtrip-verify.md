# Round-Trip Verification Utility

`scripts/roundtrip-verify.ts` compares a pre-export bundle with a post-import app data directory to ensure the round-trip workflow preserved data, attachments, and database health.

## Usage

```bash
node --loader ts-node/esm scripts/roundtrip-verify.ts \
  --before /tmp/export-a \
  --after /tmp/appdata-b \
  --out /tmp/roundtrip-diff.json \
  --sample 16 \
  --fail-on rows \
  --strict
```

### Options

| Flag | Description |
| ---- | ----------- |
| `--before <dir>` | Path to the export directory generated before wiping the database (contains `data/*.jsonl`). |
| `--after <dir>` | Path to the app data directory (or directly to `arklowdun.sqlite3`) after the import completes. |
| `--tables <csv\|all>` | Comma separated list of logical tables to verify. Defaults to `all`, which expands to `households,events,notes,files`. |
| `--include-deleted` | Include soft-deleted rows from the imported database. Use when comparing against exports that retain soft-deleted entries. |
| `--sample <n>` | Number of attachment paths to re-validate with a byte-for-byte comparison. Default: `16`. |
| `--case-fold-paths` | Case-fold attachment paths before comparison. Enabled automatically on Windows. |
| `--no-case-fold-paths` | Force case-sensitive attachment comparisons, even on case-insensitive filesystems. |
| `--out <path>` | Destination for the structured diff report. Default: `roundtrip-diff.json`. |
| `--fail-on <set>` | Failure categories to enforce (`counts`, `rows`, `attachments`, `health`, `any`). Default: `counts,attachments,health`. |
| `--strict` | Force any row-level mismatch to fail the run (equivalent to `--fail-on rows`). |
| `--help` | Print usage information. |

## Exit Codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Verification passed for all enforced categories. |
| `10` | Table counts mismatch (and counts were configured to fail). |
| `11` | Row-level mismatches detected (with strict mode or `--fail-on rows`). |
| `12` | Attachment counts, hashes, or sample comparisons failed. |
| `13` | Database health check failed. |
| `99` | Internal error (unexpected exception). |

## What is Verified?

1. **Table counts** – Ensures each logical table exports the same number of rows that were imported.
2. **Row content hashes** – Normalises rows (sorted keys, NFC strings, trimmed whitespace) and compares SHA256 hashes. Missing, extra, and mismatched IDs are reported explicitly.
3. **Attachments** – Compares attachment counts, total bytes, and SHA256 digests of every file. A deterministic subset (`--sample`) is re-read and compared byte-for-byte.
4. **Database health** – Runs the PR-01 health checks (`quick_check`, `integrity_check(1)`, `foreign_key_check`, WAL sanity) against the imported SQLite database.

### Normalisation rules & exclusions

- **Volatile columns** are excluded per table to avoid false positives from import bookkeeping:
  - `households`, `events`, and `notes` drop `updated_at` and `last_viewed_at`.
  - `files` drops `updated_at_utc` and `last_viewed_at`.
- Per-table row normalisers can be added in `scripts/roundtrip-verify.ts` when a table needs bespoke value coercion (for example to align legacy timestamp precision).
- Soft-deleted rows are ignored by default to mirror the export behaviour; enable `--include-deleted` if the export pipeline changes to ship deleted rows.
- Attachment paths are normalised to `/` separators and NFC Unicode. On Windows the tool automatically performs case-folded comparisons to match the filesystem semantics; override with `--no-case-fold-paths` when you need case-sensitive checks.
- When mismatches are detected the script prints the first five missing, extra, or mismatched IDs per table to stderr/stdout for quick triage.
- Storage sanity warnings (non-WAL mode, non-4096 page size) are treated as warnings unless `--strict` is enabled; structural corruption still fails the health check.

## Diff Report

The verification result is written to `roundtrip-diff.json` (path configurable via `--out`). The schema for this report lives at [`roundtrip-diff.schema.json`](../roundtrip-diff.schema.json). Key sections include:

- `meta` – Input paths, options used, and generation metadata.
- `health` – Outcome of individual health checks.
- `tables` – Per-table counts, hashes, and row-level differences.
- `attachments` – Aggregate counts, byte totals, SHA mismatches, and sample verification results.
- `status` – Overall status (`PASS`, `FAIL_COUNTS`, `FAIL_ROWS`, `FAIL_ATTACHMENTS`, or `FAIL_HEALTH`).

Consumers can validate the report by running any JSON Schema validator against `roundtrip-diff.schema.json`.

## Integration Notes

- The script expects the Phase 1 deterministic fixture layout. `--before` should point at the export directory produced by `arklowdun db export`.
- When `--after` targets a directory, the script reads `arklowdun.sqlite3` and `attachments/` within that directory. Pointing `--after` directly at the SQLite file is also supported.
- Health checks operate in read-only mode and will close the database connection even if a failure occurs.
- Logs summarise failing categories and always print the path of the diff report for CI artifact collection.
