# Recurrence MVP

This document outlines the minimal server-side recurrence support.

## Supported RRULE properties

- `FREQ`
- `INTERVAL`
- `COUNT`
- `UNTIL` (UTC, `Z` suffix required)
- `BYDAY`
- `BYMONTH`
- `BYMONTHDAY`
- `BYHOUR`
- `BYMINUTE`

## EXDATE

`exdates` stores comma separated UTC datetimes in ISO-8601 format, each
representing an instance start to omit.

Example:

```
2025-09-15T09:00:00Z,2025-09-22T09:00:00Z
```

## Instance IDs

Recurring instances derive a deterministic id by concatenating the parent id
and the UTC start milliseconds:

```
<event-id>::<occurrenceStartUtcEpochMs>
```

Single events use the plain `event.id` value.

## Limitations

- No per-occurrence edits.
- `RDATE` and complex change-future operations are out of scope.
- Maximum 500 instances are returned per series in a single query.
- A global cap of 10,000 instances per query prevents unbounded responses.
