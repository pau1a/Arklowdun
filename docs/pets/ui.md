# Pets UI

### Purpose

This document defines the **user interface architecture, layout, and behaviour** for the Pets domain within Arklowdun.
It covers the structure of `PetsView`, its relationship with `PetDetailView`, event handling, visual composition, and interaction flow.
All content in this document reflects the current shipped implementation under `src/PetsView.ts`, `src/PetDetailView.ts`, and `src/ui/views/petsView.ts`.

---

## 1. Overview

The Pets UI consists of two principal screens:

| Screen          | Description                                                                       | File                   |
| --------------- | --------------------------------------------------------------------------------- | ---------------------- |
| **List view**   | Displays all pets belonging to the active household and provides a creation form. | `src/PetsView.ts`      |
| **Detail view** | Shows medical records, attachments, and reminder fields for a single pet.         | `src/PetDetailView.ts` |

The router exposes `/pets` but marks it as `display: { placement: "hidden" }`, so it is not visible in the sidebar.
The command palette (`Cmd/Ctrl + K`) and search results remain the main entry points.

---

## 2. Mount lifecycle

### 2.1 Entry point

```ts
export function mountPetsView(container: HTMLElement) {
  return wrapLegacyView(container, PetsView);
}
```

* **wrapLegacyView** clears previous DOM content, calls `runViewCleanups`, and then invokes `PetsView(container)`.
* **PetsView** creates a new `<section>` wrapper and inserts it into the container.
* A fresh render is triggered each time the route hash changes to `#/pets`.

### 2.2 Clean-up

* `wrapLegacyView` wipes innerHTML and cancels listeners, but **reminder timers** survive because `scheduleAt` stores no handles.
* No persistent UI state is preserved between mounts; the list always reloads.

---

## 3. List view structure

Rendered markup hierarchy (simplified):

```html
<section class="pets">
  <header>
    <h1>Pets</h1>
  </header>
  <ul id="pets-list"></ul>
  <form id="pet-create-form">
    <input id="pet-name" placeholder="Name" required>
    <input id="pet-type" placeholder="Type">
    <button type="submit">Add</button>
  </form>
</section>
```

### 3.1 Population

* Fetches household via `getHouseholdIdForCalls()`.
* Calls `petsRepo.list(orderBy: "position, created_at, id")`.
* Stores results in local `pets` array.
* Immediately triggers `schedulePetReminders(pets)` to queue any reminders.
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
5. Calls `schedulePetReminders()` for the new pet.
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

## 8. Thematic elements

### 8.1 Vertical banner

When `/pets` route is active, `updatePageBanner.ts` loads:

```
src/assets/banners/pets/pets.png
```

and inserts it into the right-edge banner container (`container__banner`), aligned vertically top-to-bottom.
The banner has no text overlay; its purpose is contextual decoration.

### 8.2 Icons

* Search results use a paw icon (`fa-paw` from Font Awesome).
* Detail list items display bell icons for reminders.
* No breed/type-specific icons exist.

### 8.3 Colour and typography

* Inherits base theme tokens (`--radius-base`, `--shadow-base`, `--font-size-base`).
* No pet-specific SCSS file is defined; the view depends on global theme.scss.

---

## 9. State management

* **Data cache:** Local array of pets refreshed on each creation/deletion.
* **Cross-view state:** Not persisted; detail changes refresh the parent cache.
* **Reminders:** Stored in memory; re-seeded after every mutation.
* **UI store:** Pets uses standalone state, not the global `familyStore`.

---

## 10. Error handling & feedback

| Source                          | Surface                    | Mechanism                             |
| ------------------------------- | -------------------------- | ------------------------------------- |
| `petsRepo.create` failure       | Console warning only       | No toast or retry prompt.             |
| `petMedicalRepo.delete` failure | Toast via `showError`      | UI remains responsive.                |
| Vault path error                | Toast via `presentFsError` | Shows friendly message from code map. |
| Database unhealthy              | Banner “Editing disabled”  | Triggered via ensure_db_writable.     |

There are no spinners, skeletons, or visual loaders in PetsView; success is inferred from re-rendered content.

---

## 11. Performance

* **List rendering:** Tested up to 200 pets; mean render < 120 ms.
* **Medical history:** Up to 100 records; render < 100 ms.
* **No virtualisation** used; entire DOM regenerated each view.
* **Idle observers:** Only MutationObserver for resize/repaint remains active between redraws.
* **Reminders:** CPU impact negligible (< 0.5 %).

---

## 12. Testing coverage

| Area             | Coverage                                             | Status                                |
| ---------------- | ---------------------------------------------------- | ------------------------------------- |
| Unit tests (TS)  | None                                                 | Not yet implemented.                  |
| Visual QA        | Manual walkthrough only                              | Verified under macOS Monterey–Sonoma. |
| Accessibility QA | Keyboard focus verified; screen reader pass pending. |                                       |
| Performance QA   | Measured 200-card render benchmark (OK).             |                                       |

---

## 13. Known limitations

* Hidden from sidebar; accessible only through search or direct hash.
* No confirmation dialogs on delete actions.
* No undo or change history.
* No pagination or infinite scroll.
* No banner alt text for accessibility.
* Form state is cleared on every re-render.
* Reminder timers persist after navigating away from PetsView.
* Long text fields are truncated; no tooltip for full name/type.
* No offline or cache recovery mode for pet attachments.

---

## 14. Future parity targets (documentary only)

These parity points are **documented for traceability**, not promises:

| Feature                   | Target parity domain |
| ------------------------- | -------------------- |
| Empty-state visuals       | Family module        |
| Reordering via drag       | Files module         |
| Attachment preview modal  | Property module      |
| Structured toast messages | Family diagnostics   |
| Themed banner variants    | Dashboard banners    |

---

**Owner:** Ged McSneggle
**Status:** Functional, stable through PR14 baseline (macOS build only)
**Scope:** Describes UI layout, behaviours, and known limitations for the Pets domain

---
