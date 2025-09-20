# RRULE Recurrence Matrix

The recurrence matrix tests (`tests/rrule_matrix.rs`) exercise the event
expansion engine across the core RRULE fields defined in [RFC 5545,
section 3.3.10](https://datatracker.ietf.org/doc/html/rfc5545#section-3.3.10).
Each scenario seeds a series into an in-memory database, expands
`events_list_range`, and compares the results to deterministic snapshots
under `tests/rrule_snapshots/`.

> **Note:** `RDATE` scenarios are intentionally excluded from this suite.
> See [`docs/rdate-policy.md`](./rdate-policy.md) for the v1 policy and
> future planning guidance.

## Scenario Coverage

| Scenario | Timezone | RRULE Fields | Notes |
| --- | --- | --- | --- |
| `daily_london_dst` | Europe/London | `FREQ=DAILY;COUNT=5` | Spring DST forward; validates UTC shift while preserving wall-clock start. |
| `weekly_new_york_byday` | America/New_York | `FREQ=WEEKLY;INTERVAL=2;BYDAY=SU;UNTIL=20241117T063000Z` | Fall DST back; ambiguous hour resolves to earlier offset per policy. |
| `monthly_tokyo_bymonthday` | Asia/Tokyo | `FREQ=MONTHLY;INTERVAL=1;COUNT=6;BYMONTHDAY=10,20;BYHOUR=9;BYMINUTE=30` | No DST region; exercises BYMONTHDAY + BYHOUR/BYMINUTE combinations. |
| `yearly_london_leap` | Europe/London | `FREQ=YEARLY;COUNT=4;BYMONTH=2;BYMONTHDAY=29` | Leap-day annual recurrence; verifies skipping non-leap years. |

The snapshot metadata records the timezone database revision so drift
from tzdb upgrades is obvious in review. All scenarios assert that a
second expansion produces an identical vector to confirm deterministic
ordering.

## Updating Snapshots

```bash
# Regenerate all snapshots (writes into tests/rrule_snapshots/)
UPDATE_RRULE_SNAPSHOTS=1 cargo test --locked \
  --manifest-path src-tauri/Cargo.toml --test rrule_matrix -- --nocapture

# Verify without touching snapshot files
cargo test --locked --manifest-path src-tauri/Cargo.toml \
  --test rrule_matrix -- --nocapture
```

Snapshots are committed to version control. When behaviour legitimately
changes, regenerate them with the environment variable above and commit
the diff alongside the code change.

## Fixture Example

The daily London fixture spans the 2024 spring-forward change. The
snapshot (`tests/rrule_snapshots/daily_london_dst.json`) captures the
offset jump:

```json
{
  "timezone": "Europe/London",
  "rrule": "FREQ=DAILY;COUNT=5",
  "instances": [
    { "local_start": "2024-03-29T22:15:00+00:00" },
    { "local_start": "2024-03-30T22:15:00+00:00" },
    { "local_start": "2024-03-31T22:15:00+01:00" }
  ]
}
```

## Snapshot Drift Example

Intentionally editing a snapshot triggers a diff in the gate. For
example, bumping the first local time to `22:30` yields the following
failure (excerpt):

```
snapshot mismatch for daily_london_dst at tests/rrule_snapshots/daily_london_dst.json
-      "local_start": "2024-03-29T22:30:00+00:00",
+      "local_start": "2024-03-29T22:15:00+00:00",
```

CI job `gate/rrule-matrix` runs the suite on every pull request so any
unexpected drift is caught automatically.

## EXDATE removal companion suite

The same CI gate also executes the EXDATE scenarios in
`cargo test --manifest-path src-tauri/Cargo.toml --test exdate_application`.
These tests reuse the snapshot workflow and fixtures stored under
`tests/exdate_fixtures/` to prove that excluded dates are filtered before the
instances reach the IPC boundary.
