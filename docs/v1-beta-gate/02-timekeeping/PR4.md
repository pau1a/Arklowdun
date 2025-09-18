# PR-4 Mandate — Invariant Queries + Drift Report

## Objective
Introduce invariant checks that confirm events retain their intended wall-clock meaning after timezone and DST adjustments.  
Deliver a **drift detection query + reporting tool** that operators and testers can run to prove data integrity following backfill.

---

## Scope
- Implement a **Rust command** (callable via CLI and IPC) that:
  - Selects events where both wall-clock (`start_at`, `end_at`) and UTC (`start_at_utc`, `end_at_utc`) are present.
  - Recomputes the wall-clock values by converting UTC → local using the event’s timezone.
  - Compares recomputed wall-clock with stored wall-clock.
- Define thresholds:
  - **Timed events:** must match exactly (down to minute).
  - **All-day events:** can tolerate ±24h shifts depending on timezone rules, but should still align with day boundaries.
- Generate a **report** summarising drift cases and counts.
- Output options:
  - **JSON file:** full detail, one object per offending event.
  - **Human summary:** counts per household and per error type.
- Integrate with CI:
  - Provide a job that runs the check against a canned fixture DB.

---

## Non-Goals
- No attempt to auto-correct or patch data — this PR only detects drift.  
- No recurrence expansion changes (covered in later PRs).  
- No UI exposure beyond optional IPC call for dev builds.

---

## Drift Report Schema
- **Event ID**
- **Household ID**
- **Original Wall-clock start_at / end_at**
- **Recomputed Wall-clock from UTC**
- **Delta (ms)**
- **Error Category:**  
  - `timed_mismatch`  
  - `allday_boundary_error`  
  - `tz_missing`  

---

## Acceptance Criteria
1. **Correct detection:** For a crafted test DB with one intentional drift, report shows exactly one offending event.  
2. **Clean seed pass:** On a clean DB (after PR-1 backfill), report lists 0 drifts.  
3. **Threshold logic:** Timed events must match exactly; all-day events checked by day boundaries.  
4. **Output formats:** Command produces both JSON file (full detail) and console summary (counts).  
5. **Exit codes:**  
   - 0 if no drift  
   - Non-zero if drift detected  
6. **CI integration:** A job `gate/time-invariants` runs on fixture DB, fails if drift > 0, attaches JSON artifact.  
7. **Performance:** Command runs on 10k events in <5s on dev hardware.  

---

## Evidence Required in PR
- **Drift Demo (Fail):** Run against a test DB seeded with a known mismatch → console summary + JSON excerpt.  
- **Drift Demo (Pass):** Run against clean DB → console summary of zero drift, empty JSON.  
- **Threshold Proof:** Show case where all-day event across DST is accepted, but a timed event 1h off is flagged.  
- **CI Proof:** Link to passing run of new CI job with attached artifact.  
- **Performance Note:** Log excerpt of runtime on 10k fixture with elapsed time.

---

## Rollback Plan
- Remove the CLI command and CI job.  
- No schema or data mutations are introduced; rollback is non-destructive.  
- Document one-liner to disable the guard in CI if needed.

---

## PR Title / Description
- **Title:** `feat(time-invariants): add drift detection query and reporting tool`  
- **Body:** Must include Objective, Scope, Non-Goals, Report schema, Acceptance Criteria, Evidence, and Rollback.

---
```
