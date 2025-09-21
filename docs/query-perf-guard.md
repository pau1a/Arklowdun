# `gate/query-perf-smoke` — events_list_range latency guard

The manual `gate/query-perf-smoke` GitHub Action keeps a lightweight pulse on
`events_list_range` performance by executing the deterministic `time query-bench`
harness against a **1k event** SQLite fixture whenever the workflow is triggered
via the **Actions → _gate/query-perf-smoke (manual)_** entry. The job is
intentionally warning-only: it raises visibility when latency drifts but does
**not** block merges.

---

## What the job does

* Generates `fixtures/time/query/query-1k.sqlite3` via
  [`scripts/bench/generate_query_fixture.ts`](../scripts/bench/generate_query_fixture.ts)
  using seed `104729` so repeated runs produce identical fixture data.
* Invokes [`time query-bench`](../src-tauri/scripts/time_backfill.rs) with the
  helper script [`scripts/ci/query-perf-smoke.mjs`](../scripts/ci/query-perf-smoke.mjs)
  for the day, week, and month windows (`--iterations 30`, `--warmup 5`, `--seed 42`).
* Captures window-level latency aggregates (min, P50, P95, max, mean) alongside
  item counts and truncation frequency.
* Uploads `test-results/query-perf-smoke.json` as an artifact containing the full
  measurement payload (see [schema](#artifact-schema)).
* Sets a commit status named `gate/query-perf-smoke` on the chosen commit SHA so
  reviewers can require a manual run via branch protection.
* Optionally comments the Markdown latency table on the supplied PR number to
  surface the same data inline with the review thread.

Trigger the workflow from GitHub's **Actions** tab by selecting
_gate/query-perf-smoke (manual)_ and hitting **Run workflow**. Optional inputs
let you tweak fixture size, iteration counts, window selection, seeds, and the
warning threshold without changing the repository. Provide the PR's head commit
SHA in `target_sha` (defaults to the workflow run SHA) and the PR number in
`pr_number` when you want the status + comment to land on an open pull request.

Once the status is available, update branch protection for `main` to require the
`gate/query-perf-smoke` check. This preserves the manual trigger policy while
ensuring every merge records a recent measurement.

---

## Thresholds and behaviour

* **Soft ceiling:** any window with `max_ms > 500` emits a GitHub Actions warning.
* **Default threshold:** `500` ms on the 1k dataset. Override locally or in a
  dry-run workflow with `QUERY_PERF_THRESHOLD_MS=<value>`.
* **No failures yet:** regardless of warnings, the job exits with status `0` in
  this v1 rollout. Escalation to a hard failure can be done by changing the
  script exit path once baseline confidence is higher.
* **Repeatability:** using deterministic fixture + seed keeps successive runs
  within ±10% in practice; the acceptance gate targets ±15% headroom for noisy
  runners. Re-run locally if you suspect cache effects before concluding there is
  a regression.

---

## Sample output

Success path (500 ms threshold):

```text
gate/query-perf-smoke: generating 1,000-row query fixture (seed 104729)…
gate/query-perf-smoke: fixture ready at fixtures/time/query/query-1k.sqlite3
gate/query-perf-smoke: running query bench (iterations=30, warmup=5, seed=42)…

gate/query-perf-smoke: window latency summary (milliseconds)
Window    Min      P50      P95      Max   Trunc  Items(avg)
day        27.64    36.00    47.23    48.97      0     33.2
week       29.16    38.58    49.85    50.15      0    226.1
month      29.57    49.45    56.72    57.84      0  1,106.9

gate/query-perf-smoke: all windows under 500 ms threshold.
gate/query-perf-smoke: wrote timing log to test-results/query-perf-smoke.json
```

Warning-only scenario (threshold dialled to 40 ms for demonstration):

```text
gate/query-perf-smoke: generating 1,000-row query fixture (seed 104729)…
gate/query-perf-smoke: fixture ready at fixtures/time/query/query-1k.sqlite3
gate/query-perf-smoke: running query bench (iterations=30, warmup=5, seed=42)…

gate/query-perf-smoke: window latency summary (milliseconds)
Window    Min      P50      P95      Max   Trunc  Items(avg)
day        27.64    36.00    47.23    48.97      0     33.2
week       29.16    38.58    49.85    50.15      0    226.1
month      29.57    49.45    56.72    57.84      0  1,106.9

::warning title=gate/query-perf-smoke::day window exceeded 40 ms threshold (max 48.97 ms)
::warning title=gate/query-perf-smoke::week window exceeded 40 ms threshold (max 50.15 ms)
::warning title=gate/query-perf-smoke::month window exceeded 40 ms threshold (max 57.84 ms)
gate/query-perf-smoke: thresholds exceeded for 3 window(s); job remains warning-only in this revision.
gate/query-perf-smoke: wrote timing log to test-results/query-perf-smoke.json
```

Both runs store their JSON summary as an artifact for deeper inspection.

---

## Running locally

From the repo root after `npm ci`:

```sh
# Standard smoke run (writes test-results/query-perf-smoke.json)
npm run gate:query-perf-smoke

# Fast local profile (10 iterations / 2 warmups, same fixture)
npm run perf:query:local

# Force warnings to mimic CI alerting
QUERY_PERF_THRESHOLD_MS=40 npm run gate:query-perf-smoke
```

Tips:

* The script will install the 1k fixture every run; delete it if you want to
  regenerate with different parameters.
* Use `QUERY_PERF_ITERATIONS` or `QUERY_PERF_WARMUP` to experiment with longer
  sampling windows when triaging regressions.
* All parameters are documented at the top of
  [`scripts/ci/query-perf-smoke.mjs`](../scripts/ci/query-perf-smoke.mjs).

---

## Artifact schema

The uploaded `query-perf-smoke.json` artifact contains:

```json
{
  "job": "gate/query-perf-smoke",
  "threshold_ms": 500,
  "parameters": {
    "rows": 1000,
    "iterations": 30,
    "warmup": 5,
    "seed": 42,
    "windows": ["day", "week", "month"],
    "fixture_seed": 104729
  },
  "dataset": {
    "fixture": "fixtures/time/query/query-1k.sqlite3",
    "actual_rows": 1000,
    "recurrence_rows": 314,
    "exdate_series": 43,
    "dataset_start_iso": "2024-01-21T11:43:00.000Z",
    "dataset_end_iso": "2024-06-29T17:11:00.000Z"
  },
  "windows": [
    {
      "window": "day",
      "min_ms": 27.64,
      "p50_ms": 36.00,
      "p95_ms": 47.23,
      "max_ms": 48.97,
      "mean_ms": 36.52,
      "truncated": 0,
      "items": {"mean": 33.2, "p95": 64.7, "max": 67}
    },
    {
      "window": "week",
      "min_ms": 29.16,
      "p50_ms": 38.58,
      "p95_ms": 49.85,
      "max_ms": 50.15,
      "mean_ms": 39.29,
      "truncated": 0,
      "items": {"mean": 226.1, "p95": 379.5, "max": 393}
    },
    {
      "window": "month",
      "min_ms": 29.57,
      "p50_ms": 49.45,
      "p95_ms": 56.72,
      "max_ms": 57.84,
      "mean_ms": 48.16,
      "truncated": 0,
      "items": {"mean": 1106.9, "p95": 1512.3, "max": 1552}
    }
  ],
  "warnings": []
}
```

Values are rounded to two decimals above for readability; the artifact preserves
full precision as emitted by the CLI.

---

## Triage checklist when warnings fire

1. **Download the artifact** from the CI run and compare window metrics to the
   previous successful run. P95 drifting above 500 ms is the primary indicator.
2. **Re-run locally** with an empty target directory to rule out cold-cache
   effects:
   ```sh
   rm -rf src-tauri/target && npm run gate:query-perf-smoke
   ```
3. **Inspect query payloads** by running `time query-bench --keep-db` and
   reviewing the preserved SQLite working copy in `/tmp`.
4. **Escalate** if the increase reproduces locally: file a performance issue,
   include the artifact JSON, and link the offending CI run.

The guard is meant to alert early without blocking development. Tune thresholds
as the product evolves, and graduate the warnings to hard failures once a stable
latency budget is agreed.
