# Timekeeping Error Taxonomy

The timekeeping stack surfaces a stable set of error codes whenever recurrence
expansion, exclusion date normalisation, timezone backfill, or drift detection
fails. Each entry in the taxonomy has a developer-facing message (emitted by the
Rust backend) and a user-facing copy rendered by the UI. Recovery guidance
explains how to resolve the issue without inspecting logs.

| Code | Developer message | User-facing copy | Recovery guidance |
| --- | --- | --- | --- |
| `E_EXDATE_INVALID_FORMAT` | Excluded dates must use ISO-8601 UTC format (YYYY-MM-DDTHH:MM:SSZ). | One or more excluded dates are invalid. Please check format (YYYY-MM-DD). | Remove whitespace, ensure each EXDATE token is a valid UTC timestamp, and re-save the event. |
| `E_EXDATE_OUT_OF_RANGE` | Excluded dates must fall within the recurrence window. | One or more excluded dates fall outside the event's schedule. Please adjust or remove them. | Keep EXDATE values between the event start and its RRULE end/COUNT boundary, then retry. |
| `E_RRULE_UNSUPPORTED_FIELD` | Recurrence rule contains fields that are not supported. | This repeat pattern is not yet supported. | Edit the recurrence to use supported RRULE fields (FREQ, INTERVAL, COUNT, UNTIL, BYDAY/BYMONTH/BYMONTHDAY/BYHOUR/BYMINUTE). |
| `E_TZ_UNKNOWN` | Timezone identifier could not be resolved to a known location. | This event has an unrecognised timezone. Please edit and select a valid timezone. | Choose a valid IANA timezone (e.g. `Europe/London`, `America/New_York`) from the editor and save the event. |
| `E_TZ_DRIFT_DETECTED` | Stored event timestamps drifted away from their timezone offsets. | Some events no longer align with their saved timezone. Review the affected items before continuing. | Rerun the timezone backfill or manually adjust the listed events until the drift report returns clean. |

The `src-tauri/src/time_errors.rs` module defines these codes and their canonical
messages. The UI maps the same set to user copy via
`src/utils/timekeepingErrors.ts`, ensuring IPC responses, logs, and banners stay
synchronised.
