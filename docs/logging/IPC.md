# Logging IPC Contract

Status: Draft
Owner: Ged Kelly
Last updated: 2025-10-07

## Audience
Backend engineers maintaining `diagnostics_summary` and frontend engineers consuming its output.

## Request shape
* The UI issues a `diagnostics_summary` request with no parameters (`{}` when serialization requires a body).
* The backend flushes pending buffers, reads the latest rotating file tail, and returns the newest ~200 log entries.

## Response schema
```json
{
  "lines": [
    {
      "ts": "2025-10-07T18:22:10Z",
      "level": "info",
      "event": "fs_guard_check",
      "message": "...",
      "household_id": "...",
      "...": "..."
    }
  ],
  "dropped_count": 0,
  "log_write_status": "ok"
}
```

Returned lines are ordered **oldest-first**. The list contains up to 200 entries—fewer if logs have not yet reached that length.

## Field notes
* `ts` is an RFC-3339 UTC timestamp and sorts lexicographically.
* `level` always belongs to {`trace`, `debug`, `info`, `warn`, `error`}.
* `event` identifies the originating category and drives filter options in the UI.
* Additional fields may appear at any time; consumers must ignore unknown keys safely.
* `dropped_count` reports how many lines the non-blocking writer dropped (0 when none).
* `log_write_status` communicates the latest writer state (`"ok"` or `"io_error"`).

## Usage requirements
* Responses should be treated as immutable snapshots; replace the in-memory tail rather than merging.
* Polling (for Live Tail) must stop immediately upon leaving the Logs view.

## Observed payload, PR-5
Console probe (`window.__TAURI__.core.invoke('diagnostics_summary')`) captured the following representative payload:

```json
{
  "logTail": [
    "{\"ts\":\"2025-10-07T18:22:10Z\",\"level\":\"info\",\"event\":\"fs_guard_check\",\"message\":\"scan complete\"}",
    "{\"ts\":\"2025-10-07T18:22:11Z\",\"level\":\"warn\",\"event\":\"io_throttle\",\"message\":\"writer paused for 250ms\"}",
    "{\"ts\":\"2025-10-07T18:22:12Z\",\"level\":\"info\",\"event\":\"fs_guard_check\",\"message\":\"resume\"}"
  ],
  "logLinesReturned": 3,
  "logTruncated": false,
  "logAvailable": true,
  "dropped_count": 0,
  "log_write_status": "ok",
  "platform": "darwin",
  "arch": "x86_64",
  "appVersion": "1.7.2"
}
```

## Related references
* [SPEC](./SPEC.md)
* [EXPORT](./EXPORT.md)
