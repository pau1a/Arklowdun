# Pets PR3 – Reminder Engine Hardening (P2)

### Objective

Replace the current recursive `setTimeout` implementation with a cancellable scheduler registry so that:

* timers can be cancelled on unmount/route change/household switch,
* reminders don’t duplicate on remount or after list refreshes,
* “catch-up” notifications fire once per qualifying record.

No UI or schema changes are introduced in this PR.

---

## 1) Scope & intent

**In scope**

* New reminder scheduler module with cancellation, dedupe, and long-delay chunking.
* Wiring the scheduler into PetsView mount/unmount and household-change lifecycle.
* Stable, structured logging around schedule/trigger/cancel paths.
* Unit + integration tests validating timer behaviour.

**Out of scope**

* Visual changes, toasts, or new copy.
* Persisting snooze/dismiss state.
* System-wide background scheduling.

---

## 2) Deliverables

| Deliverable           | Description                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| **Scheduler module**  | `src/features/pets/reminderScheduler.ts` exporting the API in §3.1.         |
| **Lifecycle wiring**  | Cancel on unmount; reschedule on mount and after CRUD mutations.            |
| **No-dup guarantee**  | Re-entrant mounts/list refreshes do not increase active timer count.        |
| **Catch-up once**     | Past reminder but future date → exactly one immediate notification/session. |
| **Structured logs**   | `ui.pets.reminder_*` events with fields for diagnosis.                      |
| **Tests**             | Deterministic unit + integration tests (scheduling, cancellation, dedupe).  |
| **Docs**              | Update `docs/pets/reminders.md` with the new runtime model.                 |

---

## 3) Detailed tasks

### 3.1 Module API

Create `src/features/pets/reminderScheduler.ts`:

```ts
export type ReminderKey = `${string}:${string}`; // `${medical_id}:${reminder_at}`

export interface SchedulerStats {
  activeTimers: number;
  buckets: number;
}

export const reminderScheduler = {
  init(): void,                                    // idempotent; clears active timers & batches
  scheduleMany(records: Array<{ medical_id: string; pet_id: string; date: string; reminder_at: string; description: string; pet_name?: string }>, opts: { householdId: string; petNames?: Record<string, string> }): void,
  rescheduleForPet(petId: string): void,           // cancel timers tied to one pet
  cancelAll(): void,                               // cancel everything
  stats(): SchedulerStats,                         // for diagnostics/tests
};
```

Implementation notes:

* Internal `Map<ReminderKey, ReturnType<typeof setTimeout>>` stores active timeout handles.
* For delays > 2 147 483 647 ms, schedule a chain of timeouts; keep only the current handle so `clearTimeout()` cancels the chain.
* One prompt-per-session for Notification permission; cache the result in module state.

### 3.2 Keying & dedupe

* Key by medical row + timestamp (`medical_id:reminder_at`).
* Before scheduling, check the map; if present, skip.
* Maintain a session-local `Set<string>` of catch-up keys to ensure “fire once” behaviour.

### 3.3 Catch-up logic

For each medical record:

* If `reminder_at < now` **and** `date >= today`, enqueue one immediate notification unless the key exists in the catch-up set.
* Record the key in the set after firing.

### 3.4 Lifecycle wiring

* **Mount (PetsView):** after fetching pets/medical, call `reminderScheduler.init()` then `scheduleMany(...)`.
* **CRUD mutations:** after `pet_medical_create/delete/update`, call `rescheduleForPet(pet_id)`.
* **Unmount (`wrapLegacyView`/`runViewCleanups`):** call `cancelAll()`.
* **Household switch:** call `cancelAll()` before loading the new household’s data.

### 3.5 Long-delay chunking

Pseudo-logic:

```ts
const MAX = 2147483647;

function scheduleAt(fn: () => void, whenMs: number, key: ReminderKey) {
  const delay = Math.max(0, whenMs - Date.now());
  const next = delay > MAX ? MAX : delay;

  const handle = setTimeout(() => {
    if (delay > MAX) {
      // Re-chain
      scheduleAt(fn, whenMs, key);
    } else {
      try {
        fn();
      } finally {
        registry.delete(key);
      }
    }
  }, next);

  const existing = registry.get(key);
  if (existing) clearTimeout(existing);
  registry.set(key, handle);
}
```

### 3.6 Notification emission

* **Title:** `Reminder: <PetName> medical due`
* **Body:** uses description + formatted date.
* **Tag:** `pets:<medical_id>`
* **Silent:** `false`

Permission handling:

* If denied, log `ui.pets.reminder_permission_denied` and do not schedule.

### 3.7 Logging

Emit structured logs:

| Event                               | Fields                                                     |
| ----------------------------------- | ---------------------------------------------------------- |
| `ui.pets.reminder_scheduled`        | key, pet_id, medical_id, reminder_at, delay_ms, household_id |
| `ui.pets.reminder_chained`          | key, remaining_ms, household_id                              |
| `ui.pets.reminder_fired`            | key, pet_id, medical_id, reminder_at, elapsed_ms, household_id |
| `ui.pets.reminder_canceled`         | key, household_id                                           |
| `ui.pets.reminder_catchup`          | key, pet_id, medical_id, household_id                       |
| `ui.pets.reminder_permission_denied`| household_id                                                |
| `ui.pets.reminder_invalid`          | key, reason, reminder_at, household_id                       |

### 3.8 Diagnostics

* `reminderScheduler.stats()` exposes `activeTimers` and `buckets` for diagnostics/tests.
* Include in diagnostics bundle:

Diagnostics bundle excerpt:

```json
"pets": {
  "reminder_active_timers": 4,
  "reminder_buckets": 4
}
```

---

## 4) Tests

### 4.1 Unit tests (`tests/ui/pets.reminderScheduler.test.ts`)

* **Schedules once:** calling `scheduleMany()` twice with same records keeps `activeTimers` constant.
* **Cancel works:** after `cancelAll()`, `activeTimers === 0`.
* **Catch-up once:** past `reminder_at` + future `date` fires exactly one notification per key per session.
* **Chain scheduling:** for `whenMs - now > MAX`, verify chained steps end with one fire; cancel midway prevents firing.
* **Reschedule for pet:** after CRUD change, timers for that `pet_id` rebuild; others remain untouched.

### 4.2 Integration tests (`tests/ui/pets.reminder.integration.test.ts`)

* **Mount → Unmount → Mount:** timer count stable across cycles.
* **Create medical with future reminder:** new timer appears; firing triggers `reminder_fired` log.
* **Permission denied path:** no timers scheduled; `reminder_permission_denied` recorded.
* Use deterministic fake timers (`@sinonjs/fake-timers` via Node's test runner) to freeze time and advance deterministically.

---

## 5) Acceptance checklist

| Condition                                   | Status | Evidence                              |
| ------------------------------------------- | ------ | ------------------------------------- |
| Registry cancels timers on unmount          | ☑      | `tests/ui/pets.reminder.integration.test.ts` |
| Duplicate schedule avoidance                | ☑      | `tests/ui/pets.reminderScheduler.test.ts`    |
| Catch-up notification fires once            | ☑      | `tests/ui/pets.reminderScheduler.test.ts`    |
| Long-delay chunking cancellable             | ☑      | `tests/ui/pets.reminderScheduler.test.ts`    |
| Household switch clears timers              | ☑      | `tests/ui/pets.reminder.integration.test.ts` |
| Structured logs present                     | ☑      | `src/features/pets/reminderScheduler.ts` |
| Docs updated (`reminders.md`)               | ☑      | This PR diff                            |
| CI green on macOS                           | ☐      | Workflow logs                            |

---

## 6) Verification workflow

1. Launch app with tracing:

   ```bash
   RUST_LOG=info npm run tauri dev
   ```

2. Navigate to Pets → confirm `ui.pets.reminder_scheduled` entries.
3. Navigate away → confirm `ui.pets.reminder_canceled` entries and `activeTimers = 0`.
4. Return to Pets → timer count equals initial (no growth).
5. Create medical record with `reminder_at` in 5 seconds → observe fire log.
6. Create record with `reminder_at` yesterday and `date` tomorrow → immediate `reminder_catchup`.

---

## 7) Risks & mitigations

| Risk                                      | Mitigation                                             |
| ----------------------------------------- | ------------------------------------------------------ |
| Memory leaks via dangling handles         | Single registry; `cancelAll()` clears map + timeouts.  |
| Duplicate notifications on quick remount  | Keyed dedupe + idempotent `init()` guards.             |
| Permission prompt spam                    | Cache prompt result for the session.                   |
| Clock skew across chunk boundaries        | Recompute remaining delay on each chain step.          |

---

## 8) Documentation updates required

| File                       | Update                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `docs/pets/reminders.md`   | Replace “no cancellation” model with registry/cancel design.    |
| `docs/pets/diagnostics.md` | Add `reminder_active_timers` counters.                          |
| `docs/pets/plan/checklist.md` | Tick PR3 section once merged.                                 |
| `CHANGELOG.md`             | “PR3 – Reminder engine hardened (cancellable, deduped).”        |

---

## 9) Sign-off

| Role          | Name              | Responsibility                                              |
| ------------- | ----------------- | ----------------------------------------------------------- |
| **Developer** | Ged McSneggle     | Implement scheduler module, wire lifecycle, add tests.      |
| **Reviewer**  | Paula Livingstone | Verify acceptance criteria & logs.                          |
| **CI**        | Automated         | Run unit/integration suites with fake timers on macOS.      |

**Status:** Ready for implementation  
**File:** `/docs/pets/plan/pr3.md`  
**Version:** 1.0  
**Scope:** Cancellable, deduplicated, and test-verified reminder scheduling for the Pets domain.
