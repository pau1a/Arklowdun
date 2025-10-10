# Pets PR3 Scope Overview

## Objective
- Replace the recursive reminder `setTimeout` loop with a cancellable scheduler so timers can be cleared on lifecycle changes, duplicates are avoided, and catch-up notifications only fire once.
- No UI or schema changes will be shipped in this slice; the focus remains purely on scheduling and lifecycle behaviour.

## In-Scope vs. Out-of-Scope
- **In scope:**
  - Implementing a new reminder scheduler, lifecycle hooks, structured logging, and automated coverage.
  - Ensuring dedupe guarantees, catch-up logic, and diagnostic visibility for reminders.
- **Out of scope:**
  - Visual updates, snooze/dismiss persistence, background scheduling, or any schema alterations.

## Deliverables
- Dedicated `reminderScheduler` module encapsulating timer management and cancellation.
- Wiring into `PetsView` mount/unmount flows and CRUD reminder operations.
- Dedupe and catch-up guarantees, plus structured `ui.pets.reminder_*` logging fields.
- Deterministic unit and integration test suites for the scheduler.
- Updated reminder documentation reflecting the new lifecycle expectations.

## Implementation Details
- Scheduler API surface covering schedule, cancel, cancelAll, and diagnostics accessors.
- Keying strategy based on reminder identifiers and household context for dedupe.
- Catch-up logic that prevents duplicate fire-and-forget notifications.
- Lifecycle integration to automatically cancel timers on unmount and rebuild on mount.
- Long-delay chaining mechanics to stay within timer limits.
- Notification payload shape, logging field taxonomy, and diagnostics statistics emission.

## Testing & Acceptance Criteria
- Unit tests for scheduling stability, cancellation semantics, catch-up behaviour, long-delay chaining, and permission-denied handling.
- Integration tests verifying lifecycle cleanup, dedupe, catch-up, household switching, logging emission, and doc updates.

## Operational Follow-through
- Manual verification with tracing-enabled runs to confirm scheduler wiring.
- Risk mitigations covering dangling handles, duplicate notifications, prompt spam, and clock skew.
- Documentation, changelog, and diagnostics updates required post-implementation.
- Sign-off owners: Ged McSneggle (development) and Paula Livingstone (review).
