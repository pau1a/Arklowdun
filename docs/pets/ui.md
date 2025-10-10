# Pets UI

### Purpose

This document defines the **user interface architecture, layout, and behaviour** for the Pets domain within Arklowdun.
It covers the structure of `PetsView`, its relationship with `PetDetailView`, event handling, visual composition, and interaction flow.
All content in this document reflects the current shipped implementation under `src/PetsView.ts`, `src/PetDetailView.ts`, `src/features/pets/PetsPage.ts`, and `src/ui/views/petsView.ts`.

---

## 1. Overview

The Pets UI consists of two principal surfaces:

| Surface         | Description                                                                                         | File                         |
| --------------- | --------------------------------------------------------------------------------------------------- | ---------------------------- |
| **List view**   | Persistent page shell that renders the pets collection, search, inline creation, and row actions.   | `src/PetsView.ts` / `src/features/pets/PetsPage.ts` |
| **Detail view** | Full medical/reminder editor for a single pet.                                                      | `src/PetDetailView.ts`       |

The router exposes `/pets` but marks it as `display: { placement: "hidden" }`, so it does not appear in the sidebar.
The command palette (`Cmd/Ctrl + K`) and search remain the main entry points.

---

## 2. Mount lifecycle

### 2.1 Entry point

```ts
export function mountPetsView(container: HTMLElement) {
  return wrapLegacyView(container, PetsView);
}
```

* `wrapLegacyView` clears previous DOM content, calls `runViewCleanups`, and then invokes `PetsView(container)`.
* `PetsView` instantiates a `PetsPage` shell, wires callbacks, and leaves the shell mounted for the lifetime of the route.
* `updatePageBanner({ id: "pets", display: { label: "Pets" } })` is invoked on entry so the right-edge banner rail shows the pets artwork.

### 2.2 Clean-up

* `PetsPage.destroy()` tears down scroll/resize observers and event listeners. The shell itself is removed when the router replaces the container contents.
* Reminder timers created through `scheduleAt` are **not** cancelled; they fire even if navigation occurs.
* Search debounce timers are cleared via `registerViewCleanup`.
* **wrapLegacyView** clears previous DOM content, calls `runViewCleanups`, and then invokes `PetsView(container)`.
* `PetsView` creates a new `<section>` wrapper and inserts it into the container.
* A fresh render is triggered each time the route hash changes to `#/pets`.

### 2.2 Clean-up

* `wrapLegacyView` wipes innerHTML and cancels listeners. `PetsView` registers a cleanup that calls `reminderScheduler.cancelAll()` so timers do not survive unmount.
* No persistent UI state is preserved between mounts; the list always reloads.

---

## 3. Page shell structure

Rendered markup hierarchy (simplified):

```html
<section class="pets">
  <header class="pets__header">
    <h1>Pets</h1>
    <div class="pets__controls">
      <input class="pets__search" placeholder="Search pets…">
      <form class="pets__create">
        <input class="pets__input" name="pet-name" required>
        <input class="pets__input" name="pet-type">
        <button class="pets__submit">Add</button>
      </form>
    </div>
  </header>
  <div class="pets__body">
    <div class="pets__viewport" role="list">
      <div class="pets__spacer pets__spacer--top"></div>
      <div class="pets__items"></div>
      <div class="pets__spacer pets__spacer--bottom"></div>
    </div>
    <div class="pets__empty">No pets yet</div>
    <div class="pets__detail"></div>
  </div>
</section>
```

Key properties:

* The shell is created once by `createPetsPage(container)` and persists even when the list data changes.
* `pets__viewport` is the scroll container used by the virtualiser.
* `pets__detail` is a hidden host where `PetDetailView` mounts when a row is opened.
* Fetches household via `getHouseholdIdForCalls()`.
* Calls `petsRepo.list(orderBy: "position, created_at, id")`.
* Stores results in local `pets` array.
* Calls `reminderScheduler.init()` and `reminderScheduler.scheduleMany()` to queue any reminders for the fetched pets.
* Calls `renderPets()` to generate `<li>` entries.

### 3.2 `renderPets()`

* Clears existing `<ul>` content.
* Iterates through cached pets, creating `<li>` entries:

```html
<li>
  <span class="pet-name">Skye</span>
  <span class="pet-type">Husky</span>
  <button data-id="uuid">Open</button>
</li>
```

* No dedicated SCSS; relies on base element styles and global spacing tokens.
* Long names are truncated using `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`.

### 3.3 Empty state

When no pets exist, `<ul>` is rendered empty — no “No pets yet” copy is displayed.
This omission is documented and planned for improvement but is not an error.

---

## 4. Pet creation

The creation form is injected at the bottom of the list each render.

**Handler flow:**

1. User submits the form.
2. Handler reads `#pet-name` and `#pet-type`.
3. Calls `petsRepo.create()` with these values and `household_id`.
4. On success, appends returned pet to cached array and re-renders.
5. Calls `reminderScheduler.scheduleMany()` for the new pet (updating pet-name cache even if no reminders exist).
6. Does **not** wrap in `try/catch`; any rejection results in an uncaught promise warning in the console.

**Ordering rule:**
New pets are assigned `position = pets.length` (based on current in-memory list).

---

## 5. Detail view

### 5.1 Entry

Clicking an “Open” button locates the pet in the cache and calls:

```ts
PetDetailView(section, pet, persist, showList);
```

Where:

* `section` — the main container,
* `pet` — the current object,
* `persist` — callback to push edits,
* `showList` — callback restoring list view.

### 5.2 Layout

Rendered inline HTML (simplified):

```html
<section class="pet-detail">
  <button class="back">Back</button>
  <h2>Skye (Husky)</h2>

  <ul class="medical-records">
    <li>
      <span class="date">2025-09-01</span>
      <span class="description">Vaccination</span>
      <button class="open-doc">Open</button>
      <button class="reveal-doc">Reveal</button>
      <button class="delete">Delete</button>
    </li>
  </ul>

  <form id="medical-add-form">
    <input id="medical-date" type="date" required>
    <input id="medical-description" placeholder="Description" required>
    <input id="medical-reminder" type="date" placeholder="Reminder (optional)">
    <input id="medical-document" placeholder="Relative path (optional)">
    <button type="submit">Add record</button>
  </form>
</section>
```

### 5.3 Behaviour

* Loads all medical rows for the household, filters client-side for the current pet.
* Orders by `date DESC, created_at DESC, id`.
* Interpolates data into innerHTML directly — unsanitised (trusted context assumed).
* Renders attachment buttons (`Open`, `Reveal`) if `relative_path` is present.
* Deletion:

  * Calls `petMedicalRepo.delete(id)`.
  * Invokes parent `onChange()` (refreshes list).
  * Logs errors via `console.error` or `showError`.

### 5.4 Adding medical entries

* Parses `YYYY-MM-DD` to UTC-local-noon timestamps.
* Validates optional reminder date.
* Trims and sanitises `relative_path` using `sanitizeRelativePath()`.
* Calls `petMedicalRepo.create()` with `category = "pet_medical"`.
* Updates parent pet’s `updated_at` timestamp.
* Refreshes reminders immediately post-creation.

---

## 6. Interaction model

| Action                | Response                                         |
| --------------------- | ------------------------------------------------ |
| Click “Open”          | Detail view replaces list in-place.              |
| Click “Back”          | `showList()` restores list.                      |
| Submit new pet        | Pet appended to list, reminders scheduled.       |
| Submit medical record | Record appears instantly, triggers new reminder. |
| Delete medical record | Row removed and list refreshed.                  |
| Switch route          | Entire DOM wiped; view rebuilt on next load.     |

---

## 7. Keyboard and accessibility

* **Keyboard cycling:**
  Global `[` / `]` shortcuts navigate between views; Pets obeys same event mapping.
* **Escape:**
  Dismisses modals if any appear (none by default).
* **ARIA landmarks:**
  Root `<section>` labelled with `role="main"`.
* **Focus rings:**
  Inputs use default CSS outlines (`outline: var(--focus-ring)`).
* **No skip link:**
  PetsView does not define a `skip-to-content` anchor yet.

---

## 4. Virtualised list

`PetsPage` renders pets through a fixed-height virtualiser so the DOM never grows unbounded.

* **Row height:** hard-coded `--pets-row-height = 56px`; editing UI stays within the same height so layout calculations remain valid.
* **Windowing:** `BUFFER_ROWS = 8`. The current scroll position determines `firstIndex` and `lastIndex`, and only those rows are mounted.
* **Spacers:** top/bottom spacer divs expand to represent off-screen content.
* **Pooling:** rows are recycled via a pool to avoid garbage-collection churn during fast scroll.
* **Instrumentation:** every render window logs `logUI("INFO", "perf.pets.window_render", { rows_rendered, from_idx, to_idx })`. When `#/pets?perf=1` is active, `PerformanceObserver` echoes the measurements to the console.
* **Throttling:** scroll events schedule work on the next animation frame to guarantee at most one render per frame.

### Row layout

Each row contains two states:

* **Display:** name (with optional `<mark>` highlight) plus a pill showing `pet.type`, and actions (`Open`, `Edit`).
* **Editor:** inline form with name/type inputs and `Save`/`Cancel` buttons. Inputs update an editing state map so debounced renders preserve user typing.

---

## 5. Search & filtering

* The header search input emits changes through a 200 ms debounce handled in `PetsView`.
* Matching is case-insensitive across `name`, `type`, and optional `breed` fields using NFC normalisation.
* Results produce `FilteredPet` view models with highlight ranges; `PetsPage` renders `<mark>` tags around matched substrings.
* Clearing the search restores the full collection without remounting the shell.

---

## 6. Inline creation & editing

### Creation

* The inline form calls `petsRepo.create()` with `{ name, type, position: pets.length }`.
* On success the returned pet is appended to the local cache, filtered models recompute, and reminders are scheduled only for the new pet.
* The button shows a temporary "Adding…" label while the promise resolves; focus returns to the name field afterwards.

### Edit-in-place

* Clicking `Edit` swaps the row into editing mode without disturbing other DOM nodes.
* Submitting the inline form calls `petsRepo.update()` with the new name/type.
* The underlying pet cache is patched and filters rerun, producing a targeted re-render of only the visible window.

---

## 7. Detail view

* Selecting `Open` stores the current scroll offset, reveals the `pets__detail` host, and mounts `PetDetailView` inside it.
* `PetDetailView` callbacks (`persist`, `onBack`) refresh the list via `petsRepo.update()` and `petsRepo.list()` while keeping the outer shell mounted.
* Returning to the list restores the previous scroll position.

---

## 8. Interaction model

| Action                | Response                                                                 |
| --------------------- | ------------------------------------------------------------------------- |
| Scroll list           | Virtualiser recycles rows; DOM count stays bounded.                       |
| Type in search        | 200 ms debounce, list filters, matches highlighted.                       |
| Submit new pet        | Row appended if within window; shell remains mounted.                     |
| Edit row              | Inline form toggled, save patches a single row node.                      |
| Click “Open”          | Detail view renders in side host, scroll position preserved.              |
| Click “Back”          | Returns to list, reinstating previous scroll offset and filter.           |
| Switch route          | View cleanups run; reminder timers persist by design.                     |

---

## 9. Keyboard and accessibility

* Rows are focusable (`role="listitem"`, `tabIndex` default from DOM). Arrow keys within the row editor move focus naturally via standard form controls.
* Search input has `aria-label="Search pets"` for screen readers.
* Banner updates set `aria-label="Pets banner"` and toggle `aria-hidden` appropriately.

