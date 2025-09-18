# PR-9 Mandate — Recurrence Performance Envelope

## Objective
Establish baseline **performance benchmarks** for recurrence expansion and document CPU/memory envelopes.  
Ensure that recurrence generation remains within acceptable limits even for worst-case RRULE scenarios.

---

## Scope
- Implement a **benchmark harness** (Rust integration tests or standalone CLI tool) that:
  - Generates synthetic events with worst-case RRULEs (e.g., FREQ=MINUTELY, COUNT=1000).
  - Expands them to the cap (500 per series, 10,000 per query).
  - Measures wall-clock time and memory usage.
- Define and record performance budgets:
  - **Series expansion target:** ≤ 200 ms for 500 instances on baseline dev hardware.
  - **Query expansion target:** ≤ 2 s for 10,000 instances on baseline dev hardware.
- Add regression documentation:
  - Store baseline results in `/docs/recurrence-performance.md`.
  - Include hardware spec, date, and benchmark parameters.
- Integrate a light CI smoke run:
  - Executes small-scale benchmark (e.g., 100 instances).
  - Verifies execution time under a loose threshold.
  - Does not block merge on perf drift but raises a warning.

---

## Non-Goals
- No optimisation passes — this PR is **measurement-only**.  
- No changes to recurrence correctness or truncation logic (handled in PR-7/PR-8).  
- No user-facing UX changes.  

---

## Acceptance Criteria
1. **Benchmark Harness:** Tool exists and can be run locally with clear parameters.  
2. **Baseline Results:** Numbers for worst-case scenarios recorded in `/docs/recurrence-performance.md`.  
3. **Performance Budgets:** Explicit thresholds documented for 500-series and 10k-query expansions.  
4. **CI Smoke Test:** Runs a small-scale expansion, ensures runtime < threshold, logs result.  
5. **Determinism:** Benchmarks produce consistent outputs when run on same hardware.  
6. **Documentation:** Clear steps for running benchmarks manually are included in the doc.

---

## Evidence Required in PR
- **Harness Output:** Example log of benchmark run, showing expansion counts and elapsed ms.  
- **Baseline Doc:** `/docs/recurrence-performance.md` with benchmark table and budgets.  
- **CI Log:** Job output of smoke test with timing.  
- **Warning Demo:** Example CI log where runtime exceeds loose threshold and raises a warning.  
- **Repeatability Proof:** Two runs on same machine showing consistent numbers.

---

## Rollback Plan
- Remove benchmark harness and associated docs.  
- Delete CI smoke test job.  
- Leaves recurrence expansion unchanged in production.  

---

## PR Title / Description
- **Title:** `perf(recurrence): add benchmark harness and document performance envelope`  
- **Body:** Must include Objective, Scope, Non-Goals, Acceptance Criteria, Evidence, and Rollback.

---
```
