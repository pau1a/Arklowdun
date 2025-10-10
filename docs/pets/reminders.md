# Pets Reminders

### Purpose

This document describes how reminder notifications for the Pets domain are modelled, scheduled, and observed within Arklowdun.
PR3 introduced a dedicated runtime scheduler that replaces the ad-hoc `setTimeout` loop from the original UI. The new design
ensures timers can be cancelled on lifecycle changes, deduped across refreshes, and traced through structured logs and
diagnostics counters.

---

## 1. Data source

| Field          | Table         | Type                | Purpose                                                   |
| -------------- | ------------- | ------------------- | --------------------------------------------------------- |
| `reminder_at`  | `pet_medical` | TEXT (UTC ISO 8601) | Timestamp indicating when to alert the user.              |
| `date`         | `pet_medical` | TEXT (YYYY-MM-DD)   | Medical event date used to determine catch-up behaviour.  |
| `description`  | `pet_medical` | TEXT                | Rendered inside the notification body.                    |
| `pet_id`       | `pet_medical` | TEXT                | Used for dedupe and per-pet cancellation.                 |
| `household_id` | `pet_medical` | TEXT                | Populated in log metadata and diagnostics.                |

Reminders remain a **client-side** concern. No background daemon or remote queue exists; the scheduler is initialised when the
Pets UI loads and persists only for the lifetime of that renderer session.

---

## 2. Runtime scheduler module

The scheduler lives in `src/features/pets/reminderScheduler.ts` and exports an imperative API:

```ts
export const reminderScheduler = {
  init(): void,
  scheduleMany(records: ReminderRecord[], opts: { householdId: string; petNames?: Record<string, string> }): void,
  rescheduleForPet(petId: string): void,
  cancelAll(): void,
  stats(): { activeTimers: number; buckets: number },
};
```

* **`init()`** clears all in-flight timers and pending batches. It is idempotent and used on initial mount or when the entire
  dataset is reloaded.
* **`scheduleMany()`** queues a batch of reminder records. The call is asynchronous internally: permission is resolved once per
  session, the batch is deduped against the active registry, and timers are installed for future reminders. Catch-up reminders
  (past `reminder_at`, future `date`) fire immediately but only once per session.
* **`rescheduleForPet()`** cancels all timers keyed to a specific pet. Subsequent calls to `scheduleMany()` can then rebuild
  timers with the updated medical rows for that pet.
* **`cancelAll()`** clears the registry and is invoked automatically on unmount or household switch via the view lifecycle
  cleanup hook.
* **`stats()`** exposes diagnostic counters (`activeTimers`, `buckets`) that surface in Settings → Recovery exports.

Internally the module maintains:

* a `Map<ReminderKey, setTimeout handle>` registry (`ReminderKey` is `${medical_id}:${reminder_at}`) so handles can be
  cancelled deterministically;
* a `Map<string, Set<ReminderKey>>` index from `pet_id` → reminder keys, enabling targeted cancellation;
* a session-local `Set<ReminderKey>` tracking catch-up notifications already delivered, preventing duplicate alerts across
  remounts;
* a cached permission status (`granted`/`denied`) to avoid prompting more than once per session;
* a shared pet-name lookup so notifications can render friendly titles even when only medical rows are rescheduled.

---

## 3. Scheduling & dedupe

When `scheduleMany()` receives records it performs the following steps:

1. **Permission** – call `isPermissionGranted()` (and `requestPermission()` if needed). Permission results are cached; denial is
   logged once via `ui.pets.reminder_permission_denied` and no timers are created for that session.
2. **Batch merge** – merge incoming pet names into the module cache and enqueue the records for processing.
3. **Per-record handling:**
   * Skip scheduling if the key already exists in the registry.
   * Parse `reminder_at`. Invalid timestamps log `ui.pets.reminder_invalid` and are ignored.
   * If `reminder_at ≤ now` and `date ≥ today`, emit a catch-up notification immediately and add the key to the session catch-up
     set.
   * Otherwise calculate `delay_ms = reminder_at - now` and install a timer via `setTimeout`.

All timers are wrapped by `scheduleAt()` which supports **long-delay chunking**. Delays above the 32-bit timeout ceiling
(`MAX_TIMEOUT = 2_147_483_647 ms`) are chained across multiple timeouts. Each intermediate hop logs
`ui.pets.reminder_chained` with the remaining delay to aid diagnostics. Cancelling any chained reminder clears the active handle
and prevents subsequent hops.

---

## 4. Notification payload

Notifications are delivered through the shared Tauri notification bridge and use a consistent schema:

| Field     | Value                                        |
| --------- | -------------------------------------------- |
| `title`   | `Reminder: <PetName> medical due`             |
| `body`    | `<description> (<localised event date>)`     |
| `tag`     | `pets:<medical_id>`                           |
| `silent`  | `false`                                       |

Notification permission is requested once per session. If the user denies permission, `reminderScheduler` does not retry until
the next app launch.

---

## 5. Lifecycle integration

The Pets UI (`src/PetsView.ts`) wires the scheduler as follows:

* **Mount:** `runViewCleanups()` executes previous cleanups, `reminderScheduler.init()` resets state, and the initial pet list is
  converted to reminder records and passed to `scheduleMany()`.
* **CRUD mutations:** after medical records are created, updated, or deleted, the view calls `reminderScheduler.rescheduleForPet`
  with the affected `pet_id` and then invokes `scheduleMany()` with the refreshed rows for that pet.
* **Remounts & list refreshes:** calling `refresh()` without a specific pet triggers `init()` + full `scheduleMany()` to rebuild
  the registry without duplicating timers.
* **Unmount / household switch:** the view lifecycle registers `reminderScheduler.cancelAll()` as a cleanup, ensuring no timers
  survive when navigating away or loading a different household.

---

## 6. Logging & diagnostics

Every scheduling decision emits structured logs via `logUI`:

| Event                               | Details                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `ui.pets.reminder_scheduled`        | `key`, `pet_id`, `medical_id`, `reminder_at`, `delay_ms`, `household_id`   |
| `ui.pets.reminder_chained`          | `key`, `remaining_ms`, `household_id`                                      |
| `ui.pets.reminder_fired`            | `key`, `pet_id`, `medical_id`, `reminder_at`, `elapsed_ms`, `household_id` |
| `ui.pets.reminder_canceled`         | `key`, `household_id`                                                      |
| `ui.pets.reminder_catchup`          | `key`, `pet_id`, `medical_id`, `household_id`                              |
| `ui.pets.reminder_permission_denied`| `household_id`                                                             |
| `ui.pets.reminder_invalid`          | `key`, `reason`, `reminder_at`, `household_id`                             |

Diagnostics exports (Settings → Recovery → Export Diagnostics) now include:

```json
"pets": {
  "reminder_active_timers": 4,
  "reminder_buckets": 4
}
```

where `reminder_active_timers` reflects `stats().activeTimers` and `reminder_buckets` counts unique `reminder_at` values.

---

## 7. Testing strategy

Two deterministic suites cover the runtime:

* **Unit tests** – `tests/ui/pets.reminderScheduler.test.ts` exercises dedupe, cancellation, catch-up behaviour, long-delay
  chaining, and targeted rescheduling using Sinon fake timers.
* **Integration tests** – `tests/ui/pets.reminder.integration.test.ts` simulate mount/unmount cycles, verify `reminder_fired`
  logging when timers elapse, and assert the permission-denied pathway leaves the registry empty.

Both suites run under Node's test runner with fake timers, ensuring stable, deterministic coverage for timer-heavy code paths.

---

## 8. Known limitations

* Notifications remain **foreground only**—they do not persist across app restarts and there is no snooze/dismiss UI.
* Catch-up delivery is session-based. Closing and reopening the app replays catch-up reminders for rows still qualifying.
* Permission denial is cached for the session; there is no in-app affordance to re-request permission besides restarting.
* Reminder metadata currently renders a basic title/body; future PRs may supply richer localisation and deep links.

---

**Owner:** Ged McSneggle  
**Status:** Updated for PR3 – Reminder engine hardening.
