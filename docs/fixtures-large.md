# Large Fixture Seeding Guide :)

The large round-trip fixture is generated deterministically at runtime rather than being stored as a binary dump. This document explains how to reproduce the dataset, verify determinism, and understand the guarantees that the seeder enforces.

## Prerequisites

- Node.js 18 or newer
- Project dependencies installed (`npm install`)
- `ts-node` available via the project toolchain (the repository already depends on it)

## Basic command

```bash
node --loader ts-node/esm fixtures/large/seed.ts \
  --db /tmp/roundtrip.sqlite3 \
  --attachments /tmp/roundtrip_attachments \
  --reset
```

Flags:

- `--db` — absolute path where the SQLite database should be written (default: `./arklowdun.sqlite3`).
- `--attachments` — absolute directory for attachment payloads (default: `<db directory>/attachments`).
- `--seed` — PRNG seed (default: `42`).
- `--households`, `--events`, `--notes`, `--attachments-count` — override record counts while preserving ratios.
- `--summary` — optional path where the JSON summary is written in addition to stdout.
- `--reset` — remove any existing database file and attachment tree before seeding.

The seeder applies migrations automatically, seeds all supporting tables, copies attachment payloads, and prints a JSON summary when complete.

## Expected metrics (seed = 42)

A successful run with default arguments prints the following high level metrics:

```json
{
  "database": "/tmp/roundtrip.sqlite3",
  "households": 3,
  "seed": 42,
  "events": {
    "total": 10000,
    "timed": 2501,
    "allDay": 2514,
    "recurring": 2507,
    "multiDay": 2478,
    "withReminder": 4473,
    "softDeleted": 725,
    "restored": 300,
    "recurrence": {
      "daily": 823,
      "weekly": 853,
      "monthly": 831,
      "until": 514,
      "count": 1993,
      "byDay": 1676,
      "byMonthDay": 831,
      "withExdates": 1532,
      "withDuplicateExdates": 287,
      "dstEdge": 1
    }
  },
  "notes": {
    "total": 5000,
    "softDeleted": 407,
    "restored": 200,
    "withDeadline": 1714
  },
  "attachments": {
    "total": 300,
    "byRootKey": {
      "attachments": 224,
      "appData": 76
    },
    "bySourceKind": {
      "small": 256,
      "medium": 44
    },
    "reusedLogicalFiles": 8
  }
}
```

The seeder validates these ratios internally; it exits with a non-zero status if a required threshold is not met. The canonical
snapshot for CI assertions lives in `fixtures/large/expected-summary.json`.

## Determinism checks

1. **Automated verification** — the repository ships a script that seeds into a temporary directory, compares the runtime
   summary to `fixtures/large/expected-summary.json`, and validates attachment SHA256 hashes against
   `fixtures/large/expected-attachments.json`:
   ```bash
   npm run fixtures:verify
   ```
   The script exits non-zero on any mismatch and prints a diff to aid debugging. Set `KEEP_LARGE_FIXTURE_TMP=1` to preserve the
   working directory for inspection.

2. **Repeatable output** — run the seeder twice and diff the summaries:
   ```bash
   node --loader ts-node/esm fixtures/large/seed.ts --db /tmp/rt.sqlite3 --attachments /tmp/rt_assets --reset > /tmp/seed_one.json
   node --loader ts-node/esm fixtures/large/seed.ts --db /tmp/rt.sqlite3 --attachments /tmp/rt_assets --reset > /tmp/seed_two.json
   diff -u /tmp/seed_one.json /tmp/seed_two.json
   ```
   The diff should be empty, confirming stable ordering and deterministic attachment mapping.

3. **Row counts** — you can spot-check row counts directly from SQLite:
   ```bash
   sqlite3 /tmp/rt.sqlite3 'SELECT COUNT(*) FROM events;'
   ```
   The result should match the totals reported in the JSON summary.

## Data variety guarantees

The generator enforces the following invariants:

- ≥ 10,000 events with ≥ 20% all-day, ≥ 10% recurring, RRULE coverage across DAILY/WEEKLY/MONTHLY, COUNT and UNTIL variants, duplicate EXDATE handling, and at least one DST-edge recurrence.
- ≥ 5,000 notes with ≥ 25% deadlines, ≥ 5% soft-deleted, and ≥ 2% deleted-then-restored records.
- Household category coverage with contiguous positions per household and a representative subset of notes assigned `category_id`
  values so Manage/Notes filtering stays exercised end to end.
- ≥ 300 attachment-backed records mapped deterministically from a fixed corpus with both `attachments` and `appData` roots, small and medium payloads, and reuse of logical files.

Household scope: all seeded rows include a valid `household_id` and all queries/examples in this document are understood to be executed per household.

## Unicode attachment corpus

`fixtures/large/attachments/` contains only text payloads, but the filenames include NFC, NFD, and CJK codepoints to exercise cross-platform path handling. macOS users should be aware that Finder may transparently normalise filenames to NFD; when testing on macOS, rely on checksums rather than literal filename comparisons.

## Runtime expectations

On GitHub Actions `ubuntu-latest`, the seeder completes in roughly 40–45 seconds, including attachment copies. The run stays comfortably within the budget needed for future CI round-trip jobs.

## Cleanup

Use the `--reset` flag to remove previous outputs. To clean up manually:

```bash
rm -f /tmp/roundtrip.sqlite3
rm -rf /tmp/roundtrip_attachments
```

This ensures subsequent runs start from a clean slate.
