# PR-2 Mandate — Indices & Migration Guard

## Objective
Guarantee that the database schema has the correct indexes to support efficient time-based queries and ensure that the application **refuses to run** if required backfill has not yet been applied.  
This prevents silent performance issues and enforces data integrity before features depending on UTC fields are used.

---

## Scope
- Create or validate **supporting indexes** for `events` and related tables:
  - `(household_id, start_at_utc)`
  - `(household_id, end_at_utc)` if relevant
  - Any legacy indexes that must be dropped/replaced should be documented.
- Implement a **migration guard** that runs on startup:
  - Detects if there are events with `*_utc` fields still null after PR-1.
  - If found, the app aborts with a **clear, actionable error** (both in CLI and UI contexts).
- Provide a CLI subcommand to run only the **migration guard check**, printing a summary of pending backfill.

---

## Non-Goals
- No actual backfill logic — this was delivered in PR-1.  
- No UI/UX for managing backfill — only a technical guard and index enforcement.  
- No advanced indexing strategies (e.g. covering or partial indexes) unless performance evidence demands them.

---

## Acceptance Criteria
- **Index Creation:** On a clean schema, required indexes are present after migration.  
- **Idempotency:** Running migration multiple times does not duplicate indexes.  
- **Guard Behaviour:**  
  - If pending rows exist, app startup fails fast with clear message: *“Backfill required: X events missing UTC values. Run `backfill --apply` before continuing.”*  
  - If no pending rows, startup proceeds normally.  
- **CLI Command:** `migrate:check` reports counts of pending rows and exits 0 if clean, non-zero if backfill required.  
- **Cross-Platform:** Guard must work in dev, test, and production builds with identical logic.  
- **Logging:** Logs include index verification result and backfill requirement status.

---

## Evidence Required in PR
1. **Schema Snapshot:** Show `PRAGMA index_list(events)` before and after migration; include proof of required indexes.  
2. **Guard Demo (Fail):** Run on a DB with pending rows → app fails with correct message; CLI exits non-zero.  
3. **Guard Demo (Pass):** Run on a DB after backfill → app starts normally; CLI exits 0.  
4. **Idempotency Proof:** Run migration twice; indexes unchanged on second run.  
5. **Error Copy:** Paste the exact failure message and ensure it is human-readable.  
6. **Config Note:** Document the CLI flag/command for running the guard manually.

---

## Operations
- Run the guard manually with `cargo run --bin migrate -- check` to view pending counts.
- Apply the PR-1 timezone backfill via `cargo run --bin time-backfill -- --household-id <HOUSEHOLD> [--default-tz <TZ>]` (the guard refers to this as `backfill --apply`).
- Dev-only bypass: set `ARKLOWDUN_SKIP_BACKFILL_GUARD=1` (ignored in release builds) when iterating locally.

---

## Rollback Plan
- Dropping the new indexes is safe via `DROP INDEX IF EXISTS …`; no schema data loss.
- Migration guard logic can be disabled by reverting the startup check.
- Document how to bypass guard temporarily in dev builds (env flag), but not in production.

---

## PR Title / Description
- **Title:** `feat(migrations): add time indexes and startup guard for pending backfill`  
- **Body:** Must include Scope, Non-Goals, Acceptance Criteria, Evidence items, and Rollback plan above.

---
```
