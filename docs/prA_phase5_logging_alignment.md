# PR A — Phase 5: Logging & Telemetry Alignment

## Summary

- Introduced canonical guard logging that tags each denial with the guard stage, hashed relative path, household, and category context.
- Ensured allow/deny telemetry uses the shared `vault_guard_allowed` / `vault_guard_denied` events with no bespoke payloads.
- Propagated guard stage metadata onto IPC-facing errors so downstream telemetry and support tooling receive consistent context.

## Checklist Alignment

- [x] Structured logging for every vault guard success and rejection.
- [x] Log payloads scrubbed of raw paths; only hashed identifiers recorded.
- [x] IPC guard surfaces include canonical error codes and hashed context for mismatches.

## Follow-ups

- Phase 6 will extend integration coverage to assert the new telemetry contracts while exercising attachment CRUD across categories.
