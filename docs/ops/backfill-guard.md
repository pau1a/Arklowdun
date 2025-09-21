# Backfill Guard Telemetry

The backfill guard blocks migrations and application startup whenever events are
missing canonical UTC timestamps.  This guard is the preflight check that must
stay green before PR-20 can drop the legacy wall-clock columns.

## When the guard fails

The guard emits a readiness snapshot before returning an error.  Expect to see
logs in this shape when pending rows exist:

```
INFO  arklowdun backfill_guard_status ready=false total_missing=3 \
      missing_start_total=2 missing_end_total=1 households_with_pending=2 \
      pending="hh-a (start_at_utc missing 2); hh-b (end_at_utc missing 1)" \
      pending_additional=0
ERROR arklowdun backfill_guard_blocked total_missing=3 \
      missing_start_total=2 missing_end_total=1 \
      message="Backfill required: 3 events missing UTC values (2 events missing start_at_utc, 1 event missing end_at_utc). Affected households: hh-a (start_at_utc missing 2); hh-b (end_at_utc missing 1). Run backfill --apply before continuing."
```

The CLI helper prints the same breakdown and exits non-zero:

```
cargo run --bin migrate -- check --db dev.sqlite
  …
Households with events missing UTC fields:
  hh-a: start_at_utc missing 2, end_at_utc missing 0, total 2
  hh-b: start_at_utc missing 0, end_at_utc missing 1, total 1
Backfill required: 3 events missing UTC values (2 events missing start_at_utc, 1 event missing end_at_utc). Affected households: hh-a (start_at_utc missing 2); hh-b (end_at_utc missing 1). Run backfill --apply before continuing.
```

## When the guard passes

A clean database still emits a readiness line (with `ready=true`) so monitoring
can confirm the guard ran:

```
INFO  arklowdun backfill_guard_status ready=true total_missing=0 \
      missing_start_total=0 missing_end_total=0 households_with_pending=0 \
      pending="" pending_additional=0
```

No additional logs are emitted and the command exits with status 0.

## Interpreting the fields

- `ready` — `true` when every event has `start_at_utc` and, if an end exists,
  `end_at_utc`.
- `missing_start_total` / `missing_end_total` — aggregate counts
  of missing fields across all households.
- `pending` — a truncated (top five) list of households with outstanding rows.
- `pending_additional` — number of extra households beyond the ones listed.

Operators should clear every household listed in the log or CLI output before
re-running `backfill --apply`.  Once the guard reports `ready=true`, PR-20’s
schema changes can safely land.
