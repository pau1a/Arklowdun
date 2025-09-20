# PR-6 Mandate — Guardrail in CI for Drift Detection

## Objective
Integrate the drift detection tool (from PR-4) into the continuous integration (CI) pipeline as a **mandatory guardrail**.  
Ensure that any introduction of drift or regression in invariants is automatically caught before merge.

---

## Scope
- Add a new CI job `gate/time-invariants` that:
  - Spins up a test database seeded with a **canned fixture** of events.  
  - Runs the drift detection command.  
  - Fails the build if any drift > 0 is detected.  
- Capture and upload drift report (`.json`) as a CI artifact when failures occur.  
- On success, log a summary with zero drift detected.  
- Ensure the job runs in all relevant pipelines (pull requests + main branch).  
- Document this guardrail in `docs/ci-guardrails.md`.

---

## Non-Goals
- No new invariant logic (PR-4 covers this).  
- No expanded test cases (PR-5 covers this).  
- No UI exposure — this is a pipeline-only concern.  

---

## Acceptance Criteria
1. **Job defined:** New job `gate/time-invariants` appears in CI workflow file.  
2. **Fixture DB:** Builds a stable fixture database at `/fixtures/time/drift-check.db` from the deterministic SQL fixture in `/fixtures/time/drift-check-fixture.sql`.
3. **Drift threshold:** Exit code 0 when drift count = 0; exit non-zero when drift > 0.  
4. **Artifact upload:** On failure, `drift-report.json` is attached to CI run.  
5. **Summary log:** On success, console shows: *“✅ No drift detected (0 offending events)”*.  
6. **Branch protection:** Job is marked **required** for merge in repo settings.  
7. **Documentation:** `docs/ci-guardrails.md` updated with job purpose, fixture path, and failure triage instructions.  

---

## Evidence Required in PR
- **CI Run (Pass):** Screenshot/log of a green run with *“0 offending events”*.  
- **CI Run (Fail):** Intentional drift injected in fixture → job fails, `drift-report.json` artifact available.  
- **Artifact Proof:** Sample `drift-report.json` excerpt showing event IDs and deltas.  
- **Branch Protection Proof:** Screenshot or settings note confirming job is required.  
- **Doc Link:** Show updated `docs/ci-guardrails.md`.

---

## Rollback Plan
- Remove the job definition from CI workflow.  
- Delete fixture DB file.  
- Remove references from `docs/ci-guardrails.md`.  
- This leaves drift detection available as a manual tool (PR-4), but not enforced automatically.

---

## PR Title / Description
- **Title:** `ci(time-invariants): add drift detection guardrail to CI pipeline`  
- **Body:** Must include Objective, Scope, Non-Goals, Acceptance Criteria, Evidence, and Rollback.

---
```
