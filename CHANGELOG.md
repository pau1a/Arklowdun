# Changelog

## Pets PR3
- Added cancellable reminder scheduler module (`src/features/pets/reminderScheduler.ts`) with dedupe, catch-up, and long-delay chaining.
- Wired PetsView lifecycle to initialise, reschedule, and cancel reminders, and registered cleanup on unmount/household switch.
- Emitted structured `ui.pets.reminder_*` logs and surfaced scheduler stats in diagnostics exports.
- Added deterministic unit/integration tests and refreshed reminder/diagnostics documentation.

## Family PR3
- Added structured JSON logging to Family backend IPC and UI actions.
- Log levels: DEBUG, INFO, WARN, ERROR across commands and renderer events.
- New documentation: [`docs/family/logging.md`](docs/family/logging.md).

## Pets PR2
- Added typed Zod contracts for all `pets_*` and `pet_medical_*` IPC commands.
- Updated `petsRepo`/`petMedicalRepo` to validate payloads and clear search caches after writes.
- Normalised common persistence error codes and refreshed Pets IPC documentation.
