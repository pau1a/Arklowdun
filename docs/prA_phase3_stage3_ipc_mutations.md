# PR A — Phase 3.3: IPC Attachment Mutations

## Objective

Extend the guarded vault resolution flow introduced for IPC reads to the
mutating attachment commands so create, update, and delete requests enforce the
same perimeter checks before touching the filesystem or database.

## Implemented Changes

- Added attachment mutation guards that resolve requested paths through the
  shared `Vault`, verify active household membership, and normalise inputs
  before delegating to the existing command layer.
- Reworked the IPC macro helpers to compute mutation guards for each request
  and pass the contextual data into `commands::*` so the vault is resolved
  exactly once per operation.
- Updated the `commands` module to consume the new guard structure, remove the
  old optional vault handle, and ensure attachment deletions honour the
  resolved path when present.
- Added targeted Tokio tests covering invalid categories, traversal attempts,
  and active-household mismatches to prove the guard layer emits the canonical
  error codes required by PR A.

## Follow-Ups

- Phase 3.4 will bring the same guard path to background workers so scheduled
  clean-up tasks inherit the unified attachment resolver.
- Once CI provides the missing `glib-2.0` dependency, integration tests should
  exercise the new guard flow end-to-end across create/update/delete IPC
  requests.
