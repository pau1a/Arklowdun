# Changelog

## Family PR3
- Added structured JSON logging to Family backend IPC and UI actions.
- Log levels: DEBUG, INFO, WARN, ERROR across commands and renderer events.
- New documentation: [`docs/family/logging.md`](docs/family/logging.md).

## Pets PR2
- Added typed Zod contracts for all `pets_*` and `pet_medical_*` IPC commands.
- Updated `petsRepo`/`petMedicalRepo` to validate payloads and clear search caches after writes.
- Normalised common persistence error codes and refreshed Pets IPC documentation.
