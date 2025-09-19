# Timekeeping Invariant Test Suite

The timekeeping invariant suite exercises the drift detection logic that verifies
stored calendar events continue to represent the intended wall-clock time after
DST transitions, timezone moves, and leap-day spans. The suite builds on the
PR-4 drift checker and is wired into CI via the `gate/time-invariants-tests`
workflow job.

## Policies

- **Nonexistent local times:** advance to the first valid instant after the gap
  (e.g., 02:15 during spring-forward becomes 03:00).
- **Ambiguous local times:** choose the earlier UTC offset when a wall clock
  occurs twice during fall-back.
- **Timed drift threshold:** flag events that drift by 60 seconds or more.
- **All-day events:** require midnight alignment in the stored timezone; only
  boundary shifts trigger drift.

Bump `TIMED_DRIFT_THRESHOLD_MS`/`ALL_DAY_BOUNDARY_SLACK_DAYS` only with matching
fixture edits so expectations stay consistent.

## Schema Notes

- `events.start_at`/`events.end_at` persist local wall-clock milliseconds
  exactly as produced by `NaiveDateTime::timestamp_millis()` (mirrored in the
  `encode_local_ms` helper). These columns never contain timezone offsets; the
  companion `tz` column is required to decode them back to wall-clock strings.

## How to Run

- Run locally:
  ```bash
  cd src-tauri
  cargo test --test time_invariants_scenarios -- --nocapture
  ```
- CI coverage: the `gate/time-invariants-tests` job runs on every workflow
  invocation, is marked as a required status check in branch protection, and
  fails the pipeline if any scenario regresses.
- Fixture location: `fixtures/time/invariants/*.json` (annotated fixtures used
  by the automated tests).

## Scenario Coverage

### 1. DST Spring Forward — America/New_York (2025-03-09)
- **Fixture:** `fixtures/time/invariants/dst_spring_forward.json`
- **Focus:** A daily 9:00 standup before and after the 2am→3am jump must remain
  a 09:00 meeting.
- **Expectation:** No drift records. UTC offsets adjust from −05:00 to −04:00
  without changing the stored wall-clock value.
- **Reference:** [timeanddate.com – 2025 New York DST change](https://www.timeanddate.com/time/change/usa/new-york?year=2025).

### 2. DST Spring Gap Mapping — America/New_York (2025-03-09)
- **Fixture:** `fixtures/time/invariants/nonexistent_local.json`
- **Focus:** An event seeded at the nonexistent 02:15 local time is advanced to
  03:00, demonstrating the “map forward to the first valid instant” policy.
- **Expectation:** No drift is reported and the stored local start is emitted
  as 03:00 in logs.
- **Reference:** [timeanddate.com – 2025 New York DST change](https://www.timeanddate.com/time/change/usa/new-york?year=2025).

### 3. DST Fall Back — Europe/London (2025-10-26)
- **Fixture:** `fixtures/time/invariants/dst_fall_back.json`
- **Focus:** The 9:00 standup across the repeated 02:00 hour stays a single
  occurrence once clocks return to GMT. A 01:30 support shift exercises the
  ambiguous-time policy and should also remain stable.
- **Expectation:** No drift events. UTC offsets shift from +01:00 to +00:00 and
  recomputation lands on the stored wall-clock values once per day.
- **Reference:** [timeanddate.com – 2025 London DST change](https://www.timeanddate.com/time/change/uk/london?year=2025).

### 4. Leap Day Stability — 2024-02-29
- **Fixture:** `fixtures/time/invariants/leap_day.json`
- **Focus:** Single-day meetings on leap day and an overnight deployment that
  crosses into March.
- **Expectation:** No drift events. Single events and the overnight span stay
  aligned as the calendar rolls over to March without moving the wall-clock
  time.
- **Reference:** [Wikipedia – Leap day](https://en.wikipedia.org/wiki/Leap_year#Leap_day).

### 5. Cross-Timezone Moves — UTC vs Asia/Tokyo
- **Fixture:** `fixtures/time/invariants/cross_timezone.json`
- **Focus:** The same UTC event is recomputed in UTC and Asia/Tokyo to
  demonstrate a correct 9-hour offset after relocation.
- **Expectation:** No drift records. Test logs include the recomputed local
  times for UTC and Tokyo to document the successful wall-clock translation.
- **Reference:** [timeanddate.com – Tokyo timezone](https://www.timeanddate.com/time/zone/japan/tokyo).

### 6. All-day vs Timed Thresholds
- **Fixture:** `fixtures/time/invariants/all_day_vs_timed.json`
- **Focus:** Validate detection thresholds—timed events drifted ≥1 minute are
  flagged, while all-day events only fail when midnight boundaries slip.
- **Expectation:**
  | Event ID               | Expected Outcome            |
  |------------------------|-----------------------------|
  | `timed-stable`         | Pass                         |
  | `timed-drift-45s`      | Pass (below 60s threshold)   |
  | `timed-drift-65s`      | `timed_mismatch` drift       |
  | `allday-stable`        | Pass                         |
  | `allday-boundary-drift`| `allday_boundary_error` drift |
- **Reference:** Derived from the PR-4 invariant specification (timed drift
  ≥60 seconds, all-day events must stay on midnight boundaries).

## Failure Demonstration

The suite purposefully injects known bad data to prove failure paths:
- `timed-drift-65s` and `allday-boundary-drift` fixtures create measurable drift
  and assert the `timed_mismatch` and `allday_boundary_error` categories.
- Test output (captured in CI) prints each detected drift event alongside the
  computed delta in milliseconds, providing a clear failure trace when
  regressions appear.

## Adding New Scenarios

1. Create a new annotated fixture under `fixtures/time/invariants/` describing
   the events and expectations.
2. Add a corresponding `#[tokio::test]` in
   `src-tauri/tests/time_invariants_scenarios.rs` that seeds the fixture and
   asserts the expected drift categories.
3. Update this document with the scenario summary and reference materials.
4. Verify locally with `cargo test --test time_invariants_scenarios -- --nocapture`.

