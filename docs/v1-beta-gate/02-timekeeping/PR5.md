# PR-5 Mandate — Invariant Test Suite

## Objective
Provide a suite of **automated tests** that exercise the timekeeping invariants across a range of edge conditions (DST shifts, timezone changes, leap days).  
These tests ensure that the backfill and event storage logic preserve the intended wall-clock meaning of events.

---

## Scope
- Create a **test harness** (Rust + Node, as appropriate) that:
  - Seeds in-memory or fixture databases with crafted events.
  - Runs the invariant checks (from PR-4).
  - Asserts results against expected outcomes.
- Scenarios to cover:
  1. **DST Spring Forward:** e.g., New York, 2025-03-09, 2 am → 3 am.
  2. **DST Fall Back:** e.g., London, 2025-10-26, 2 am repeated.
  3. **Leap Day:** Events spanning 2024-02-29.
  4. **Cross-timezone Moves:** Change system timezone from UTC to Asia/Tokyo and recompute.
  5. **All-day vs Timed:** Validate day-boundary stability for all-day, exact matching for timed.
- Coverage expectations:
  - Timed events flagged if drifted by ≥1 minute.
  - All-day events flagged only if they slip across day boundaries.
- Integrate test suite into CI pipeline.

---

## Non-Goals
- No UI testing — this is backend correctness only.  
- No performance benchmarks — covered in later PRs.  
- No recurrence expansion testing — covered by PR-7 onward.

---

## Acceptance Criteria
1. **Test Fixtures:** Dedicated fixture DBs (or in-memory seeds) for each scenario.  
2. **Automated Assertions:** Each fixture run proves invariants hold or drift is detected as intended.  
3. **DST Forward Case:** 9 am recurring meeting remains 9 am after spring forward.  
4. **DST Backward Case:** 9 am recurring meeting remains a single instance, not duplicated.  
5. **Leap Day Case:** 29 Feb event remains stable; expansion continues into March correctly.  
6. **Cross-Timezone Case:** Same UTC event recomputes to the correct local wall-clock in Tokyo vs UTC.  
7. **CI Integration:** Job `gate/time-invariants-tests` executes full suite and fails if any scenario regresses.  
8. **Documentation:** Scenarios, expected outcomes, and references to DST/leap rules are written up in `/docs/time-invariants.md`.

---

## Evidence Required in PR
- **Test Run Logs:** CI output showing each scenario executed and all assertions green.  
- **Sample Fixture:** Show one fixture file for DST forward with annotated expected behaviour.  
- **Failure Demo:** Temporary injection of a known drift proves test fails as expected.  
- **Cross-TZ Demo:** Log excerpt of the same event recomputed in UTC vs Tokyo.  
- **Doc Proof:** Link to `/docs/time-invariants.md` with scenario descriptions.

---

## Rollback Plan
- Delete the test suite files and remove CI job `gate/time-invariants-tests`.  
- No schema or runtime code changes, rollback leaves production behaviour unaffected.

---

## PR Title / Description
- **Title:** `test(time-invariants): add automated DST, leap day, and cross-TZ test suite`  
- **Body:** Must include Objective, Scope, Non-Goals, Acceptance Criteria, Evidence, and Rollback.

---
```
