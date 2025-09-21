# Timezone Backfill Throughput Baseline

Fixtures are **not** committed; run the generator first.

## Environment
- **Date:** 2025-09-20T20:48:03Z (UTC)
- **Host:** GitHub Codespaces container
- **CPU:** Intel(R) Xeon(R) Platinum 8272CL @ 2.60GHz (5 vCPU)
- **Memory:** 9.9 GiB RAM (0 GiB swap)
- **Operating system:** Ubuntu 24.04.2 LTS (noble)
- **Binary:** `cargo run --locked --bin time`

## Methodology
- Benchmarks execute the timezone backfill via the new `time backfill-bench` subcommand.
- Run the generator script to create `.sqlite3` fixtures before benchmarking.
- Fixtures live under `fixtures/time/backfill/backfill-<rows>.sqlite3`. A temporary working copy of each fixture is created automatically for every run.
- Unless otherwise noted the benchmark was invoked as:
  ```sh
  cargo run --locked --bin time -- backfill-bench --rows <N> --chunk-size 500 --progress-interval 0
  ```
  (`--progress-interval 0` disables extra progress logs; the runtime clamps it to the default 1 s interval internally.)
- Metrics reported by the CLI include elapsed wall-clock time, rows scanned/updated/skipped, rows-per-second throughput, and per-chunk timings (count, average, p95, maximum, and raw CSV rows).

## Results
| Run | Dataset | Rows | Chunk size | Elapsed (s) | Throughput (rows/s) | Avg chunk (ms) | p95 chunk (ms) | Max chunk (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Smoke | backfill-1k.sqlite3 | 1,000 | 500 | 0.169 | 5,917.16 | 83.50 | 107.35 | 110 |
| Baseline A | backfill-10k.sqlite3 | 10,000 | 500 | 1.518 | 6,587.62 | 74.80 | 89.70 | 141 |
| Baseline B | backfill-10k.sqlite3 | 10,000 | 500 | 1.484 | 6,738.54 | 72.95 | 83.15 | 86 |
| Baseline | backfill-100k.sqlite3 | 100,000 | 500 | 47.663 | 2,098.06 | 236.96 | 377.15 | 775 |

### Repeatability
Two successive 10k runs (Baseline A/B) differed by 2.3%, well inside the ±10% repeatability goal.

### Variance snapshot (100k fixture)
Per-chunk CSV emitted by the harness highlights steady-state performance and outliers:
```
chunk_index,scanned,updated,skipped,elapsed_ms
1,500,500,0,362
2,500,500,0,380
3,500,500,0,414
4,500,500,0,367
5,500,500,0,380
6,500,500,0,357
7,500,500,0,404
8,500,500,0,360
9,500,500,0,384
10,500,500,0,349
...
73,500,500,0,335
74,500,500,0,293
75,500,500,0,775  # peak chunk (checkpoint flush)
76,500,500,0,277
77,500,500,0,268
78,500,500,0,236
79,500,500,0,252
80,500,500,0,212
...
199,500,500,0,126
200,500,500,0,90
```

## Observations
- All runs scanned and updated every candidate row; zero rows were skipped across the fixture datasets.
- Throughput stays flat between 1k and 10k fixtures (~6.6k rows/sec) but drops to ~2.1k rows/sec on the 100k dataset as WAL checkpoints and chunk serialization dominate.
- The 100k run shows a single 775 ms chunk (chunk 75) attributable to SQLite checkpoint work; most other chunks stay below 400 ms.
- The harness copies fixtures into a temporary file for isolation—rerunning benchmarks resets the working database automatically.

## Reproducing locally
1. Ensure Rust (stable toolchain) and Node dependencies for Tauri are installed.
2. Generate the desired fixtures:
   ```sh
   node --loader ts-node/esm scripts/bench/generate_backfill_fixture.ts --rows 1000
   node --loader ts-node/esm scripts/bench/generate_backfill_fixture.ts --rows 10000
   node --loader ts-node/esm scripts/bench/generate_backfill_fixture.ts --rows 100000
   ```
   (Adjust `--rows` as needed; fixtures default to a deterministic Mulberry32 seed of 42.)
3. From the repository root run the desired benchmark. Examples:
   ```sh
   (cd src-tauri && cargo run --locked --bin time -- backfill-bench --rows 10000 --chunk-size 500 --progress-interval 0)
   (cd src-tauri && cargo run --locked --bin time -- backfill-bench --rows 100000 --chunk-size 500 --progress-interval 0)
   ```
4. Inspect stdout for the benchmark summary and the per-chunk CSV rows. The `--keep-db` flag preserves the working database for post-run inspection.
