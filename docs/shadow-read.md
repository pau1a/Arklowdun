# Shadow Read Window

The shadow-read window allows operators to validate the UTC timestamp backfill
before the legacy wall-clock columns are removed. During this period all time
queries read both the legacy `start_at`/`end_at` columns and the new
`start_at_utc`/`end_at_utc` columns. Results returned to the UI always come from
the UTC data, while the legacy values are compared silently so mismatches can be
reviewed.

## Enabling or disabling comparisons

Shadow reads are controlled with the `ARK_TIME_SHADOW_READ` environment
variable:

- `on` *(default)* – every event row read by `events_list_range` is compared,
  with discrepancies logged and counted.
- `off` – the command queries only the UTC columns. Legacy values are ignored
  and no shadow metrics are updated.

The flag is evaluated in both the desktop app and the `time` maintenance CLI, so
operators can toggle the behaviour for targeted investigations.

## Discrepancy logs and counters

When a mismatch is detected the backend emits a structured warning log with the
`time_shadow_discrepancy` event name. Each entry includes:

- event ID and household ID,
- the timezone used for conversion,
- the legacy and UTC start/end values, and
- the absolute delta in milliseconds.

The logs honour existing redaction rules and avoid paths, secrets, or other
sensitive payloads.

Totals are persisted in the `shadow_read_audit` table. The `time shadow-report`
CLI command summarizes the current state:

```text
$ ARK_TIME_SHADOW_READ=on cargo run --locked --bin time -- shadow-report
Shadow-read mode: on
Total rows inspected: 1250
Discrepancies detected: 3

Last discrepancy:
  Event ID: e18
  Household: hh7
  Timezone: America/New_York
  Start delta (ms): 60000
    Legacy start (ms): 1700244000000
    UTC start (ms): 1700244060000
  Observed at (ms): 1700764505123
```

Use the totals to judge whether UTC backfill results remain trustworthy before
dropping the legacy columns in PR-20.
