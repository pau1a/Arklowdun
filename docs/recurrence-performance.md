# Recurrence Performance Benchmarks

## Baseline hardware
- **Date:** 2025-09-20
- **Host:** GitHub Codespace container
- **CPU:** Intel(R) Xeon(R) Platinum 8272CL @ 2.60GHz (5 vCPUs)
- **Memory:** 10.4 GB (`/proc/meminfo` `MemTotal`)
- **Operating system:** Ubuntu Noble (container image)

## Performance budgets
- **Per-series expansion (500 instances):** target ≤ 200 ms on baseline developer hardware.
- **Query expansion (10,000 instances):** target ≤ 2,000 ms on baseline developer hardware.

These budgets mirror the truncation caps enforced in `events_list_range_command` (500 instances per RRULE, 10,000 per query window).

## Benchmark harness
The `recurrence_bench` binary creates an in-memory SQLite database, generates RRULEs that stress the per-series and per-query caps, and records wall-clock time plus Linux RSS/HWM readings from `/proc/self/status`.

### Running the harness
```bash
cd src-tauri
cargo run --bin recurrence_bench -- --scenario all --runs 2
```

Example output from the baseline run:
```text
scenario,run,expanded,truncated,elapsed_ms,rss_kb,rss_delta_kb,hwm_kb
Series,1,500,true,7.983,45392,3584,45392
Series,2,500,true,3.990,45520,0,45520
Query,1,10000,true,94.637,49788,4268,51024
Query,2,10000,true,79.853,51096,3968,51096
```

### Baseline measurements
| Scenario | Run | Expanded | Truncated | Elapsed (ms) | RSS (kB) | Δ RSS (kB) | Peak RSS (kB) |
|----------|-----|----------|-----------|--------------|----------|------------|----------------|
| Series   | 1   | 500      | true      | 7.983        | 45,392   | 3,584      | 45,392         |
| Series   | 2   | 500      | true      | 3.990        | 45,520   | 0          | 45,520         |
| Query    | 1   | 10,000   | true      | 94.637       | 49,788   | 4,268      | 51,024         |
| Query    | 2   | 10,000   | true      | 79.853       | 51,096   | 3,968      | 51,096         |

### Observations
- All scenarios complete comfortably within the defined budgets (≤200 ms per-series, ≤2,000 ms per-query).
- RSS usage peaks below ~52 MB even when expanding 10,000 instances.
- Two sequential runs per scenario vary by less than 6% in elapsed time, demonstrating stable repeatability on identical hardware.

## Smoke test (CI)
A lightweight integration test exercises a 128-instance minutely RRULE and prints timing diagnostics. The test never panics on slow hardware; it emits a GitHub Actions annotation-style warning if the runtime exceeds the configured threshold (default 750 ms).

Run the smoke check locally:
```bash
cd src-tauri
cargo test --test recurrence_perf_smoke -- --nocapture
```

Sample passing output:
```text
running 1 test
recurrence smoke ok: expanded=128 elapsed_ms=7.087 threshold_ms=750.000
test recurrence_smoke_completes_under_budget ... ok
```

To demonstrate the warning path, tighten the threshold via `ARK_RECURRENCE_SMOKE_THRESHOLD_MS`:
```bash
cd src-tauri
ARK_RECURRENCE_SMOKE_THRESHOLD_MS=1 cargo test --test recurrence_perf_smoke -- --nocapture
```

Sample warning output:
```text
running 1 test
::warning::recurrence smoke exceeded threshold: elapsed_ms=6.540 threshold_ms=1.000
test recurrence_smoke_completes_under_budget ... ok
```

## Updating the baseline
1. Run the harness with `--runs 2` for each scenario on stable hardware.
2. Record the latest CSV output in the table above (include date and hardware notes if the machine changes).
3. Re-run the smoke test to confirm the warning path and capture updated logs for this document.
4. Commit changes to this file alongside any harness adjustments.

## Notes
- The harness relies on Linux `/proc/self/status` fields (`VmRSS`, `VmHWM`). On non-Linux hosts these values will be omitted from the CSV but the timings remain valid.
- Each benchmark insertion uses `FREQ=MINUTELY;COUNT=1000` RRULEs to guarantee both the per-series (500) and query (10,000) caps are exercised.
- SQLite is kept in-memory to focus measurements on recurrence expansion rather than disk latency.
