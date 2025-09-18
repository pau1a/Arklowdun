# PR-7 Mandate — RRULE Matrix (Core Fields)

## Objective
Deliver a comprehensive **recurrence test matrix** covering the core RRULE fields and validating correctness across multiple timezones, including DST and leap year edge cases.  
This ensures recurrence expansion is deterministic, exhaustive (within caps), and consistent with expected calendar behaviour.

---

## Scope
- Create a structured test suite that generates and validates event instances using the recurrence engine.  
- Core RRULE fields to cover:
  - `FREQ` (DAILY, WEEKLY, MONTHLY, YEARLY)
  - `INTERVAL`
  - `COUNT`
  - `UNTIL`
  - `BYDAY`
  - `BYMONTH`
  - `BYMONTHDAY`
  - `BYHOUR`
  - `BYMINUTE`
- Timezones under test:
  - **Europe/London** (DST forward/back)
  - **America/New_York** (DST forward/back)
  - **Asia/Tokyo** (no DST, large UTC offset)
- Define **expected behaviours** for each combination, stored in fixture snapshot files.
- Assertions:
  - Instances expand deterministically (same order, same count).
  - Caps respected (per-series and per-query, handled in PR-8).
  - All events remain stable under DST and leap year transitions.

---

## Non-Goals
- No EXDATE or RDATE handling (separate PRs).  
- No truncation UX (covered in PR-13).  
- No performance benchmarks (covered in PR-9).  

---

## Acceptance Criteria
1. **Matrix Coverage:** At least one fixture test per RRULE field listed, with variations across 3 timezones.  
2. **Deterministic Expansion:** Re-running expansion yields identical instance lists (bit-for-bit).  
3. **DST Edge Cases:** Instances correctly skip/align across spring-forward and fall-back transitions.  
4. **Leap Year:** February 29 recurrences are correctly handled (next valid instance in non-leap years).  
5. **Snapshot Baseline:** Results checked into `tests/rrule_snapshots/` for regression tracking.  
6. **CI Integration:** Job `gate/rrule-matrix` runs on each PR; fails on snapshot drift.  
7. **Documentation:** `/docs/recurrence-matrix.md` describes scenarios, expected outcomes, and references RFC 5545.

---

## Evidence Required in PR
- **Fixture Example:** One test case file showing a DAILY FREQ across London DST with expected vs actual snapshot.  
- **Snapshot Files:** Added under `tests/rrule_snapshots/`, showing deterministic outputs.  
- **CI Run (Pass):** Green run showing no snapshot drift.  
- **CI Run (Fail):** Example of deliberate change causing snapshot mismatch → CI fails with diff output.  
- **Doc Link:** `docs/recurrence-matrix.md` included with coverage table.

---

## Rollback Plan
- Remove recurrence matrix tests and associated snapshots.  
- Delete CI job `gate/rrule-matrix`.  
- No production code affected; engine reverts to prior untested state.

---

## PR Title / Description
- **Title:** `test(recurrence): add RRULE matrix across core fields and timezones`  
- **Body:** Must include Objective, Scope, Non-Goals, Acceptance Criteria, Evidence, and Rollback.

---
```
