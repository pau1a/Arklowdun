# PR A — Phase 3.2: IPC Attachment Reads

## Objective

Ensure the IPC entrypoints that open or reveal attachments resolve all paths
through the shared vault instance while enforcing guard errors and returning the
canonical error taxonomy when invalid paths are requested.

## Implemented Changes

- Extracted `resolve_attachment_for_ipc_read` so both IPC commands share a
  single code path for descriptor loading, active household validation, and
  vault resolution.
- Routed `attachment_open` and `attachment_reveal` through the shared helper to
  guarantee guard errors bubble up with the standard context keys and hashed
  logging.
- Added Tokio-based unit tests covering absolute and traversal path rejection to
  prove the guard layer blocks unsafe requests before the OS is invoked.

## Follow-Ups

- Phase 3.3 will extend the shared helper to the create/update/delete IPC
  commands once their staging workflows are routed through the vault.
- Integration harnesses should exercise these commands end-to-end after the CI
  environment gains the missing `glib-2.0` dependency so the new tests can run
  alongside the broader suite.
