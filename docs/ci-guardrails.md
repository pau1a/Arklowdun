# CI Guardrails

## `gate/time-invariants`

**Purpose.** Provides an on-demand run of the wall-clock drift detector from
`cargo run --bin time -- invariants`. Maintainers should dispatch it manually
before merging changes that might introduce drift regressions or break the
drift reporting CLI.

**Trigger.** From the Actions tab, select the **CI** workflow and click
**Run workflow** for the target branch or commit. The workflow only runs when
triggered manually; it does not execute automatically on pushes or pull
requests.

**Fixture.** The job assembles a deterministic SQLite database at
`fixtures/time/drift-check.db` from the text fixture
`fixtures/time/drift-check-fixture.sql`. The dataset mixes timed and all-day
events across several time zones and is curated so that zero drift is expected.
Each CI run rebuilds the database from scratch before invoking the CLI and
executes `sqlite3 fixtures/time/drift-check.db 'PRAGMA integrity_check;'` to
guard against corruption. Recreate the same fixture locally with:

```
rm -f fixtures/time/drift-check.db
sqlite3 fixtures/time/drift-check.db < fixtures/time/drift-check-fixture.sql
```

**Command.** The guard runs from `src-tauri/` with:

```
cargo run --locked --bin time -- invariants \
  --db ../fixtures/time/drift-check.db \
  --output drift-report.json \
  --pretty
```

The binary exits with status `0` when no drift is detected and returns `2` when
at least one offending event is found.

**Success output.** When the fixture is clean the job prints the human summary
followed by `✅ No drift detected (0 offending events)`. The absence of a drift
report artifact is expected in this case.

**Failure handling.** If the command exits non-zero the workflow automatically
uploads `src-tauri/drift-report.json` as a build artifact. To triage a failure:

1. Download the `drift-report` artifact from the `gate/time-invariants` job.
2. Inspect the JSON for the offending events. Each record includes the event ID,
household, recomputed timestamps, and the measured delta. A representative
excerpt looks like:
   ```json
   [
     {
       "event_id": "timed_drift",
       "household_id": "hh1",
       "start_at": 1710061200000,
       "recomputed_start_at": 1710057600000,
       "recomputed_end_at": 1710061200000,
       "delta_ms": 3600000,
       "category": "timed_mismatch"
     }
   ]
   ```
3. Reproduce locally with the same command against the freshly generated
   fixture (or a modified variant) to validate a fix.

**Intentional failure for debugging.** The legacy SQL fixture at
`fixtures/time/drift-check-failing.sql` still contains drift cases. Building a
temporary database from that file and running the guard command locally is the
quickest way to generate a failing report for experimentation or documentation:

```
rm -f fixtures/time/drift-check.db
sqlite3 fixtures/time/drift-check.db < fixtures/time/drift-check-failing.sql
```

**Merge discipline.** Because the workflow only runs via manual dispatch, it
cannot be enforced through required status checks. Run it for any change that
touches drift-sensitive code paths and ensure the run completes successfully
before merging.
