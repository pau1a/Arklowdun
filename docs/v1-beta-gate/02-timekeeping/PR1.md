# PR-1 Mandate — Backfill Engine (Chunked + Resumable)

## Objective
Introduce a robust backfill mechanism to populate missing `*_utc` fields from existing wall-clock fields in the events table.  
The process must be **chunked, resumable, idempotent**, and produce clear progress reporting.

---

## Scope
- Add a new **Rust command** (callable via CLI and optionally IPC) that iterates through events with null `*_utc` fields.
- Fill UTC values using the wall-clock time plus the event’s stored timezone (or default).
- Process in **configurable chunks** to avoid long locks.
- Track **progress checkpoints** so interrupted runs can resume without starting over.
- Provide a **dry-run mode** that reports how many rows would be updated, without writing changes.
- Emit **progress events** during execution (counts processed/remaining).
- Log a **summary report** at completion.

---

## Non-Goals
- No changes to recurrence expansion logic.  
- No UI polish or UX design (placeholder Settings/CLI entry point is enough).  
- No deletion of legacy columns — this is for later PRs.  
- No performance optimisation beyond chunking.

---

## Acceptance Criteria
- **Idempotency:** Running backfill twice in a row produces zero new updates on the second run.  
- **Resumability:** Cancelling midway (e.g. SIGINT, IPC cancel) and restarting resumes from the last checkpoint.  
- **Dry-Run:** `--dry-run` produces counts without DB changes.  
- **Progress Reporting:** Emits progress every N rows (configurable); logs include total scanned, updated, skipped.  
- **Chunked Execution:** Uses transaction batches of fixed size (default 500, configurable).  
- **Safety:** If a row cannot be updated (e.g. missing TZ info), it is skipped and logged, not silently dropped.  
- **Summary Report:** At completion, print JSON summary: `{ household_id, total_scanned, total_updated, total_skipped, elapsed_ms }`.

---

## Evidence Required in PR
1. **Log Excerpt:** Show backfill run on a seed DB with missing UTC values; include before/after row counts.  
2. **Dry-Run Output:** Example JSON report showing counts without DB changes.  
3. **Resumability Demo:** Run with small chunk size, interrupt after first batch, restart, and show it resumes correctly.  
4. **Idempotency Proof:** Run twice consecutively on same DB, second run produces zero updates.  
5. **Config Proof:** Show command-line flags for `--dry-run`, `--chunk-size`, `--progress-interval`.  
6. **Error Handling Demo:** Example log line where a row was skipped with reason.  
7. **Code Organization Note:** Path of new command file, and where checkpoint state is persisted (in DB, not memory only).

---

## Rollback Plan
- Revert to previous commit: no schema changes introduced.  
- To undo data updates, restore from backup or re-import seed DB.  
- Documented one-liner to drop `*_utc` values back to NULL for all rows (for testing only).

---

## PR Title / Description
- **Title:** `feat(time-backfill): introduce chunked, resumable backfill for UTC fields`  
- **Body:** Must include Scope, Non-Goals, Acceptance Criteria, Evidence items, and Rollback plan above.

---
```
