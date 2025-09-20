# EXDATE Application Test Suite

The recurrence engine now has a dedicated snapshot suite to prove that
`EXDATE` values suppress the correct instances across timezones, DST shifts
and calendar edge cases. The tests live in `src-tauri/tests/exdate_application.rs`
and load canonical fixtures from `tests/exdate_fixtures/`.【F:tests/exdate_fixtures/exdate_scenarios.json†L1-L53】

## Scenario coverage

| Scenario | Timezone | Focus | EXDATE payload |
| --- | --- | --- | --- |
| `single_exdate_removal` | UTC | Removes the exact occurrence supplied in the exclusion list. | `2024-05-02T09:00:00Z` |
| `multiple_bulk_exdates` | Europe/Berlin | Applies a multi-value EXDATE list and verifies both removals. | `2024-04-11T16:30:00Z`, `2024-04-13T16:30:00Z` |
| `duplicate_exdates_are_idempotent` | America/Los_Angeles | Duplicate EXDATE tokens are ignored after the first match. | `2024-06-08T15:00:00Z` (x2), `2024-06-22T15:00:00Z` |
| `dst_transitions_are_respected` | America/New_York | Spring-forward and fall-back Sundays are removed even though offsets change. | `2024-03-10T06:30:00Z`, `2024-11-03T05:30:00Z` |
| `leap_day_exdate_propagates` | Europe/London | Leap-day recurrence drops 2024 while later leap years continue. | `2024-02-29T08:00:00Z` |

Each scenario expands the RRULE via the `rrule` crate **and** calls
`events_list_range_command`. The results must match the committed snapshots
exactly, ensuring the backend engine and IPC layer filter the same instances.

## Running the suite

```bash
# Execute the EXDATE scenarios and snapshot assertions
cargo test --manifest-path src-tauri/Cargo.toml --test exdate_application -- --nocapture

# Regenerate snapshot fixtures (writes tests/exdate_fixtures/exdate_expected.json)
cargo test --manifest-path src-tauri/Cargo.toml --test exdate_application -- --ignored --nocapture
```

Snapshots live alongside the scenario definitions in
`tests/exdate_fixtures/`. `exdate_scenarios.json` describes the seed data and
`exdate_expected.json` records the instance list after exclusions. Both files
are committed so regressions show up as diffs in review.

## Evidence

- **Failing demo:** When the EXDATE filter is bypassed the suite flags the
  drift immediately. The example below comes from intentionally running the
  tests with an empty snapshot map—the suite prints the expected snapshot and
  aborts the assertion for `multiple_bulk_exdates`.【b91d76†L1-L57】

  ```
  missing snapshot for multiple_bulk_exdates. add entry:
  {
    "expected_count": 3,
    "instances": [...]
  }
  thread 'exdate_rrule_engine_matches_snapshots' panicked at ...
  ```

- **Passing demo:** With the committed snapshots present the suite confirms
  both engines agree and exits cleanly.【b02941†L1-L10】

  ```
  running 3 tests
  test regenerate_exdate_snapshots ... ignored
  test exdate_rrule_engine_matches_snapshots ... ok
  test exdate_events_list_range_matches_snapshots ... ok
  ```

- **DST case:** The snapshot shows that the series jumps directly from
  3 March to 17 March (spring-forward removal) and omits the ambiguous
  3 November recurrence while keeping the following week.【F:tests/exdate_fixtures/exdate_expected.json†L6-L244】

  ```json
  {
    "start_utc": "2024-03-03T06:30:00Z"
  },
  {
    "start_utc": "2024-03-17T05:30:00Z"
  }
  ...
  {
    "start_utc": "2024-10-27T05:30:00Z"
  },
  {
    "start_utc": "2024-11-10T06:30:00Z"
  }
  ```

## Snapshot locations

- Scenario definitions: `tests/exdate_fixtures/exdate_scenarios.json`
- Snapshot output: `tests/exdate_fixtures/exdate_expected.json`
- Regeneration helper: `regenerate_exdate_snapshots` (ignored test in
  `src-tauri/tests/exdate_application.rs`)

## CI integration

The `gate/rrule-matrix` job now runs this suite in addition to the original
RRULE matrix snapshots so any EXDATE regression breaks the gate immediately.
