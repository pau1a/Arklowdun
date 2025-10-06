# PR A — Phase 3.4: Background Jobs & Workers

## Objective

Align the asynchronous export pipeline with the vault guard perimeter so all
background attachment access flows through the unified resolver and inherits the
same canonical error taxonomy and logging guarantees established in earlier
phases.

## Implemented Changes

- Reworked the export module to accept the shared `Vault` instance, replacing
  direct filesystem joins with `vault.resolve` and hashed guard logging when
  attachments are missing or invalid.
- Normalised export manifests to include household and category context while
  copying attachments, adding structured error context for every filesystem
  operation performed outside the vault.
- Added a Tokio test proving traversal attempts in background exports are
  rejected with the `PATH_OUT_OF_VAULT` code, ensuring guard enforcement covers
  scheduled tasks.

## Follow-Ups

- Phase 3.5 completed the repository-wide audit and helper cleanup; see the
  `prA_phase3_stage5_final_audit.md` log for the final verification results.
- Once CI installs the missing `glib-2.0` dependency, the new export tests
  should run automatically to guard against regressions.
