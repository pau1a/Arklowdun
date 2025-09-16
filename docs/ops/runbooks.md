# Crash ID Triage

Use this runbook whenever support receives a screenshot or report that includes
`Something went wrong. Crash ID: <ID>.`

## Collect

1. Ask the user for the full Crash ID string and approximate local timestamp.
2. Confirm the platform (macOS/Windows/Linux) to locate the correct log
   directory.

## Locate logs

1. On macOS the default path is
   `~/Library/Application Support/com.arklowdun.app/logs/`. Windows installs
   write to `%APPDATA%\com.arklowdun.app\logs\`.
2. Copy the logs locally if the user cannot send them. Otherwise unpack the
   archive into a scratch directory.

## Search by Crash ID

```sh
rg "crash_id=<ID>" arklowdun.log*
```

- Expect at least one `critical_failure` line and often a preceding
  `panic_caught` or domain-specific event.
- When multiple log files match, read the newest timestamp first.

## Analyze

1. Read surrounding log entries (same Crash ID) to understand which command or
   subsystem failed. Most critical logs include `code` and `message` fields.
2. Use the stack/context fields in the JSON to correlate with bug reports or
   telemetry.
3. If the log came from a panic, also review the `panic_hook` entry for the raw
   payload/location.

## Follow-up

- File or update a bug with the Crash ID, the triggering action, and the log
  snippet.
- Ask the user to retry once a fix ships; Crash IDs are unique per failure.

## Smoke test the pipeline

- Run `cargo run --bin crash_probe` locally. The tool emits a new Crash ID,
  prints it to stdout, and logs a `crash_probe_triggered` + `critical_failure`
  pair you can locate via `rg`.
