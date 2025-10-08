# Logging policy (PR3)

PR3 introduces structured logging for all Family flows. Logs are JSON objects written through the existing Tauri logging infrastructure and subject to the global retention policy (5 files × 5 MB). This document defines the required fields, levels, and emission points.

## Log envelope
```json
{
  "ts": 0,                // epoch ms
  "level": "INFO",       // TRACE | DEBUG | INFO | WARN | ERROR
  "area": "family",      // constant for every log in this plan
  "cmd": "family_members_update", // IPC command name or ui event id
  "household_id": "...", // optional for UI events when available
  "member_id": "...",    // optional, omit when not relevant
  "rows": 1,              // optional count of affected rows
  "ms": 12,               // optional duration in milliseconds
  "crash_id": "...",     // optional; populated when bubbling errors include crash reports
  "msg": "updated member",// human-readable summary
  "details": { ... }      // optional JSON object for additional context
}
```

## Backend instrumentation
- **Entry logs**: DEBUG level emitted at the start of every Family command (existing CRUD plus new commands from [ipc_extensions.md](ipc_extensions.md)). Include `cmd`, `household_id`, and `member_id` when present.
- **Success logs**: INFO level emitted on completion with `ms` (duration), `rows` (rows changed or returned), and `msg` summarising the operation.
- **Validation warnings**: WARN level when a request fails explicit validation (error codes listed in [ipc_extensions.md](ipc_extensions.md#error-code-appendix), e.g., `VALIDATION/EMAIL`, `RENEWALS/INVALID_OFFSET`). Include `details` describing the failing field and value (mask sensitive data such as full account numbers by redacting middle digits).
- **Errors**: ERROR level when an unexpected failure occurs. Include `details.error` with the Rust error chain and any SQLite constraint name.
- **Special case**: When the repository detects database health issues (write lock timeouts, disk full), log WARN with `msg = "DB_UNHEALTHY"` and propagate the error.

## UI instrumentation
- Emit INFO logs under synthetic command names prefixed with `ui.`:
  - `ui.family.load` with `{ ms, household_id, members: count }` when the initial `familyStore.load` resolves.
  - `ui.family.drawer.save` with `{ ms, member_id }` when save completes (success or failure). Use WARN for validation failures.
  - `ui.family.attach.add` / `ui.family.attach.remove` with `{ ms, member_id, attachment_id }`.
  - `ui.family.renewal.save` and `ui.family.renewal.delete` with relevant identifiers.
- UI logs reuse the same JSON structure as backend logs and flow through the same transport.

## Redaction rules
- Do not log full contents of sensitive fields. For example, log `passport_number` as `"***1234"` by keeping only the last four characters.
- Phone numbers and email addresses may be logged in full for validation messages, but ensure they reside under `details` to keep top-level fields clean.
- Attachment paths should be split into `root_key` and `relative_path`; avoid logging absolute filesystem paths.

## Sampling and rate limiting
- No sampling is applied. Commands expected to fire frequently (list, store load) must still log each invocation due to their diagnostic value.
- To avoid log storms during drag/drop operations, coalesce consecutive failures (e.g., multiple invalid files) into a single WARN with `details.count`.

## Testing requirements
- Integration tests in PR3 assert that calling `family_members_update` results in DEBUG (entry) and INFO (success) logs.
- Renderer tests spy on the logging transport to confirm `ui.family.drawer.save` fires once per save.

These rules remain in force for all subsequent PRs. Any new Family-related command introduced later must adopt the same envelope and levels.
