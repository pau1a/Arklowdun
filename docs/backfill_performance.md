## Local (Mac) run

**Host:** macOS (Paula’s MacBook Pro)  
**Command:** `cargo run --locked --bin time -- backfill-bench --rows <N> --chunk-size 500 --progress-interval 0`

| Run        | Dataset               | Rows    | Chunk size | Elapsed (s) | Throughput (rows/s) | Avg chunk (ms) | p95 chunk (ms) | Max chunk (ms) |
|------------|-----------------------|---------|------------|-------------|---------------------|----------------|----------------|----------------|
| Baseline A | backfill-10k.sqlite3  | 10,000  | 500        | 0.234       | 42,735.04           | 11.15          | 16.20          | 20             |
| Baseline   | backfill-100k.sqlite3 | 100,000 | 500        | 12.447      | 8,034.06            | 61.69          | 109.10         | 120            |

**Notes**
- All rows scanned and updated; zero skips.  
- 100k shows expected steady-state chunk timings; max ~120 ms with WAL checkpoints.  
- Throughput is significantly higher than Codespaces due to local SSD/CPU. Treat these as *best-case reference* numbers.
