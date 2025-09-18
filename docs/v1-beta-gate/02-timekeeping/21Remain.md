# Timekeeping Correctness Plan — PR Roadmap

This document outlines the sequence of pull requests required to make the app handle time and timezones correctly.  
Each PR has a clear scope, acceptance criteria, and required evidence.

---

## PR-1: Backfill Engine (Chunked + Resumable)
- **Scope:** Add a resumable backfill command that fills missing `*_utc` fields from wall-clock fields; process in chunks with checkpoints and idempotency.
- **Acceptance:** Backfill can be stopped/restarted without duplicating work; dry-run prints counts; chunk size configurable.
- **Evidence:** Log excerpt showing checkpointing; run on seed DB with “before/after” row counts.

## PR-2: Indices & Migration Guard
- **Scope:** Ensure supporting indexes exist (household + time columns), and migration guard refuses to boot app if schema requires backfill.
- **Acceptance:** Cold start fails fast with actionable message when backfill pending; index creation is no-op when present.
- **Evidence:** Migration plan text + index existence check output.

## PR-3: CLI/UI Trigger + Progress Events
- **Scope:** Add a safe entry point (CLI or Settings) to run backfill with progress, pause/resume, and completion summary.
- **Acceptance:** Progress ticks visible; cancellation leaves DB consistent; summary includes counts/elapsed.
- **Evidence:** Screen capture of progress and a summary snippet.

---

## PR-4: Invariant Queries + Report
- **Scope:** Ship SQL + a small command that finds events whose wall-clock ≠ recomputed wall-clock (after TZ/DST rules).
- **Acceptance:** Report lists 0 drift on clean seed; configurable tolerance.
- **Evidence:** Sample report file and docs entry describing thresholds.

## PR-5: Invariant Test Suite
- **Scope:** Tests that simulate DST forward/back and system TZ change; assert same human time for all-day and timed events.
- **Acceptance:** Tests fail if any drift is introduced by future changes.
- **Evidence:** CI job “gate/time-invariants” goes green.

## PR-6: Guardrail in CI
- **Scope:** Add a job that runs the drift report on a canned fixture DB.
- **Acceptance:** Build fails if report > threshold; artifact attached on failure.
- **Evidence:** CI config link + a passing run.

---

## PR-7: RRULE Matrix (Core Fields)
- **Scope:** Test matrix for FREQ, INTERVAL, COUNT, UNTIL, BYDAY/BYMONTH/BYMONTHDAY, BYHOUR/BYMINUTE across three timezones.
- **Acceptance:** Deterministic instance ordering; expansion stops at caps but is otherwise exhaustive.
- **Evidence:** Matrix results summary and deterministic snapshot file.

## PR-8: Expansion Limits & Errors
- **Scope:** Enforce per-series (e.g., 500) and query (10 000) caps; define and surface a specific “truncated” state.
- **Acceptance:** Engine never over-expands; UI/API gets a clear “truncated” signal.
- **Evidence:** Tests for over-cap rules + a UI proof (banner/text spec).

## PR-9: Performance Envelope
- **Scope:** Benchmark expansions for worst-case rules; document CPU/time budgets.
- **Acceptance:** Baseline numbers published; follow-up issues if over budget.
- **Evidence:** Benchmark doc with timings and parameters.

---

## PR-10: EXDATE Normalisation
- **Scope:** Normalise EXDATE storage (ordering, dedupe, canonical format), strict parse with clear error on bad tokens.
- **Acceptance:** Duplicate/unsorted inputs become a unique, ordered set; malformed tokens rejected with actionable messages.
- **Evidence:** Before/after examples; tests covering dupes, whitespace, bad formats.

## PR-11: EXDATE Application Tests
- **Scope:** Tests proving EXDATEs are removed correctly across TZ/DST edges.
- **Acceptance:** No “ghost” instances survive; no over-exclusion.
- **Evidence:** Green test runs + fixture docs.

## PR-12: RDATE Stance (Document Only)
- **Scope:** Document RDATE as out of scope for v1; log a design note for future support.
- **Acceptance:** Clear statement in docs and roadmap.
- **Evidence:** Link to roadmap section.

---

## PR-13: Truncation UX
- **Scope:** Add a banner/badge when recurrence results are truncated.
- **Acceptance:** Banner appears only when cap hit; accessible (role, keyboard).
- **Evidence:** Screenshot with annotated state + UX copy in docs.

## PR-14: Timezone Context Badge
- **Scope:** Show a badge/tooltip indicating event timezone when different from current app TZ.
- **Acceptance:** Only shows when relevant; no visual noise.
- **Evidence:** Screenshot + rule description.

## PR-15: Error Taxonomy Mapping
- **Scope:** Map engine errors (bad EXDATE, impossible RRULE) to stable, localisable messages.
- **Acceptance:** No raw technical errors leak to UI; codes documented.
- **Evidence:** Error mapping table in docs + a failing/handled test.

---

## PR-16: Backfill Throughput Benchmark
- **Scope:** Scripted run on 10k/100k fixtures; record rows/sec, chunk time, total time.
- **Acceptance:** Baseline numbers published; thresholds set for regressions.
- **Evidence:** Benchmark table and fixture hash.

## PR-17: Query Latency Benchmark
- **Scope:** Measure `events_list_range` under common windows (day/week/month) at 10k events.
- **Acceptance:** P50/P95 documented; target budgets defined.
- **Evidence:** Results doc + CI job that spot-checks on small fixture.

## PR-18: Regression Guard in CI
- **Scope:** Add a light CI job that runs a micro-benchmark and warns on large regressions.
- **Acceptance:** Not a merge blocker initially; produces trend artifacts.
- **Evidence:** CI log + artifact link.

---

## PR-19: Shadow-Read Window + Flag
- **Scope:** Introduce a feature flag where reads consult both legacy and new columns; log counters for usage.
- **Acceptance:** Flip can be turned off to validate new-only path; logs prove low/no legacy reads.
- **Evidence:** Config doc + log excerpt.

## PR-20: Drop Legacy Columns
- **Scope:** Migration that removes legacy columns after a grace period; upgrade script checks zero pending backfills.
- **Acceptance:** Safe on clean DB; aborts with clear message if pre-conditions not met.
- **Evidence:** Dry-run output + migration note.

## PR-21: Rollback/Repair Playbook
- **Scope:** Document and script the “export → rebuild → restore” path; include checksums and integrity verification.
- **Acceptance:** Rehearsed on a test DB; step-by-step doc is concise and accurate.
- **Evidence:** Run log + final verified counts.

---

# Coordination Notes
- Land **PR-1..3** before **PR-4..6** so invariants run on stable data.  
- Land **PR-10** before **PR-7..9** to ensure EXDATE handling is stable.  
- Gate **PR-13** behind a flagged API status so UI can merge early safely.  
- Schedule **PR-20** after at least one full regression cycle of invariants + benchmarks.

---

# PR Hygiene
Each PR must include:
- **Scope & non-goals** (one paragraph each).  
- **Acceptance checklist** (3–5 bullets).  
- **Evidence** (logs, snapshots, benchmarks).  
- **Rollback** (one paragraph with affected files/migration undo).  
```
