# Pets Reminders

### Purpose

This document describes how **reminders** for the Pets domain are created, stored, and executed.
Reminders provide timed notifications to alert the user of upcoming or overdue medical events such as vaccinations, check-ups, or treatments.
They are implemented entirely within the client runtime and have no server or background service dependency.

---

## 1. Design overview

Reminders in the Pets feature are a **client-side scheduling layer** built on top of the `pet_medical` table.
Each `pet_medical` row may include a `reminder_at` timestamp.
The scheduler reads these timestamps when the Pets view loads and sets in-memory timers to trigger local notifications through the browser Notification API (wrapped by Tauri’s notification plugin).

No persistent queue or background daemon exists — timers live only as long as the Pets view or the main application process.

---

## 2. Data source

| Field          | Table         | Type                | Purpose                                                   |
| -------------- | ------------- | ------------------- | --------------------------------------------------------- |
| `reminder_at`  | `pet_medical` | TEXT (UTC ISO 8601) | Timestamp indicating when to alert the user.              |
| `date`         | `pet_medical` | TEXT (YYYY-MM-DD)   | Medical event date used to decide catch-up notifications. |
| `description`  | `pet_medical` | TEXT                | Displayed in notification body.                           |
| `pet_id`       | `pet_medical` | TEXT                | Used to associate reminder with pet.                      |
| `household_id` | `pet_medical` | TEXT                | Used for scoping and lookups.                             |

All timestamps are stored in UTC and converted to local time in the UI when reminders are scheduled.

---

## 3. Scheduling logic

### 3.1 Entry point

The scheduler runs automatically when `PetsView` mounts:

```ts
schedulePetReminders(petsArray);
```

This function:

1. Ensures notification permission is granted (or requests it).
2. Iterates through all pets and their `medical` arrays.
3. For each medical record with a future `reminder_at`, creates a timer.
4. For any record whose reminder timestamp is already past but `date` is still in the future, triggers an *immediate catch-up* notification.

### 3.2 `scheduleAt`

The helper `scheduleAt(fn, timestamp)` handles actual scheduling:

* Calculates the delay as `timestamp - Date.now()`.
* Caps each delay at **2 147 483 647 ms** (~24.8 days), the maximum supported by `setTimeout`.
* If the reminder lies farther in the future, it schedules the first chunk and recursively requeues itself after the first timeout fires.

Example simplified logic:

```ts
function scheduleAt(fn, targetTime) {
  const MAX_DELAY = 2147483647;
  const delay = Math.max(0, targetTime - Date.now());
  if (delay > MAX_DELAY) {
    setTimeout(() => scheduleAt(fn, targetTime), MAX_DELAY);
  } else {
    setTimeout(fn, delay);
  }
}
```

Timers are never recorded or returned, so there is **no mechanism to cancel** pending reminders after they are queued.

---

## 4. Notification format

Notifications are displayed using the Tauri notification plugin, following the same schema as Family reminders.

| Field      | Example                                                     |
| ---------- | ----------------------------------------------------------- |
| **Title**  | `Reminder: Skye vaccination due`                            |
| **Body**   | `Skye’s vaccination booster is due tomorrow (11 Oct 2025).` |
| **Icon**   | `src/assets/icons/paw.png`                                  |
| **Tag**    | `pets-<uuid>`                                               |
| **Silent** | `false`                                                     |

**Permission model:**
If permission is `default` or `denied`, the scheduler requests it once at startup. Users declining notifications simply won’t receive reminders until manually re-enabled.

---

## 5. Triggering logic

When a reminder fires:

1. The notification is shown immediately.
2. The app logs an event:

```json
{
  "ts": "2025-10-10T07:00:00Z",
  "domain": "pets",
  "event": "reminder_fired",
  "pet_id": "6e6b3c7a...",
  "medical_id": "a4f2e012...",
  "description": "Vaccination booster"
}
```

3. The callback completes silently — no persistence or re-scheduling is attempted unless the view reloads.

---

## 6. Catch-up handling

If a reminder timestamp lies in the past but the event date has not yet occurred, the scheduler issues an immediate notification to warn the user that the reminder was missed.

Example:

* `reminder_at`: 1 Oct 2025, 09:00
* `date`: 20 Oct 2025
  → A catch-up notification is fired immediately when the app opens on 10 Oct 2025.

---

## 7. Refresh and teardown

* **Refresh:** Every time Pets data are re-fetched (e.g. after creating or deleting medical records), the scheduler clears its cache and re-runs over the current dataset.
* **Teardown:** `wrapLegacyView` clears DOM content on unmount, but timers remain live because `scheduleAt` doesn’t expose handles. The consequence is that notifications may still appear briefly after leaving the Pets pane. This behaviour is known and documented.
* **Reset:** Full app restart or household switch resets all reminder timers.

---

## 8. Error handling

| Scenario                        | Response                                                 |
| ------------------------------- | -------------------------------------------------------- |
| Notification permission denied  | Scheduler skips reminders silently.                      |
| Invalid or unparsable timestamp | Log warning via `console.warn("Invalid reminder time")`. |
| Timer scheduling failure        | Caught by global error boundary; no crash.               |
| Household context lost          | Scheduler aborts without setting timers.                 |

No user-visible alert is raised for permission denial or invalid data; issues are confined to logs.

---

## 9. Logging and diagnostics

Each reminder setup or trigger produces structured logs via `ui.family.ui` channel (shared UI log facility):

| Event                      | Level  | Fields                                    |
| -------------------------- | ------ | ----------------------------------------- |
| `reminder_scheduled`       | `info` | pet_id, medical_id, reminder_at, delay_ms |
| `reminder_fired`           | `info` | pet_id, medical_id, elapsed_ms            |
| `reminder_skipped_invalid` | `warn` | reason                                    |

Diagnostics collection counts reminders indirectly via `pet_medical` rows with non-null `reminder_at`.

Example log sequence:

```
2025-10-10T06:02:15Z  [ui.pets.reminder_scheduled]  Skye booster due 2025-11-10T09:00Z
2025-11-10T09:00:01Z  [ui.pets.reminder_fired]      Skye booster fired after 86400000 ms
```

---

## 10. UI interaction

* **Reminder form fields:**
  The Pet Medical entry form provides an optional “Reminder date” input (calendar picker).
  Dates are parsed to local noon, converted to UTC before storage.

* **Visual cues:**
  Medical records with upcoming reminders show a small bell icon in the detail list.
  Overdue reminders display in red with tooltip “Reminder time passed”.

* **Behaviour after firing:**
  Notifications do not mark the record as “done.” They simply remind the user; the user must manually edit or delete the medical entry to remove the bell icon.

---

## 11. Testing approach

* **Unit tests:** Verify scheduler calculates correct delay, handles past/future times, and respects 24-day cap.
* **Integration tests:** Validate permission flow, immediate catch-up logic, and absence of double-scheduling.
* **Manual QA:** Check notifications appear when expected under macOS Notification Center; confirm icon and body content render correctly.

Performance target: < 2 ms average setup time per reminder.

---

## 12. Known limitations

* No persistence or cancellation of timers after unmount.
* No multi-device or system-level reminder integration.
* Notifications cannot open deep links (currently ignored).
* No user snooze/dismiss state is recorded.
* Reminders scheduled beyond 24.8 days rely on recursive re-queuing, so precision may drift by a few seconds across cycles.
* The notification icon is static (`paw.png`) for all pets.

---

**Owner:** Ged McSneggle
**Status:** Active; behaviour verified in closed-beta code snapshot 0026
**Scope:** Defines reminder scheduling, triggering, and diagnostic behaviour for the Pets domain

---
