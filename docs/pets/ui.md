# Pets UI

### Purpose

This document defines the **user interface architecture, layout, and behaviour** for the Pets domain within Arklowdun.
It covers the structure of `PetsView`, its relationship with `PetDetailView`, event handling, visual composition, and interaction flow.
All content in this document reflects the current shipped implementation under `src/PetsView.ts`, `src/ui/pets/PetDetailView.ts`, `src/features/pets/PetsPage.ts`, and `src/ui/views/petsView.ts`.

---

## 1. Overview

The Pets UI consists of two principal surfaces:

| Surface         | Description                                                                                         | File                         |
| --------------- | --------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Card grid**   | Persistent page shell that renders the pets collection, search, inline creation, and card actions.  | `src/PetsView.ts` / `src/features/pets/PetsPage.ts` |
| **Detail view** | Full medical/reminder editor for a single pet.                                                      | `src/ui/pets/PetDetailView.ts` |

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
<section class="pets" role="region" aria-labelledby="pets-title-…">
  <p class="sr-only" id="pets-status-…" role="status" aria-live="polite">Loading pets…</p>
  <p class="sr-only" id="pets-list-help-…">
    Use the arrow keys to move between pets. Press Enter to open details. Press Escape to return to the list.
  </p>
  <header class="pets__header">
    <h1 id="pets-title-…">Pets</h1>
    <div class="pets__controls">
      <label class="sr-only" for="pets-search-…">Search pets</label>
      <input class="pets__search" id="pets-search-…" placeholder="Search pets…" type="search">
      <form class="pets__create" aria-describedby="pets-create-help-…">
        <input class="pets__input" name="pet-name" required aria-label="Pet name">
        <input class="pets__input" name="pet-type" aria-label="Pet type (optional)">
        <button class="pets__submit">Add pet</button>
        <p class="sr-only" id="pets-create-help-…">
          Enter a pet name and optional type, then select Add pet.
        </p>
      </form>
    </div>
  </header>
  <div class="pets__body">
    <div
      class="pets__viewport"
      role="list"
      tabindex="0"
      aria-labelledby="pets-title-…"
      aria-describedby="pets-status-… pets-list-help-…"
    >
      <div class="pets__spacer pets__spacer--top"></div>
      <div class="pets__grid"></div>
      <div class="pets__spacer pets__spacer--bottom"></div>
    </div>
    <div class="pets__empty">
      You haven’t added any pets yet. Each will appear here with their photo and details.
    </div>
    <div class="pets__detail"></div>
  </div>
</section>
```

Key properties:

* The shell is created once by `createPetsPage(container)` and persists even when the list data changes.
* `pets__viewport` is the scroll container used by the virtualiser.
* `pets__grid` hosts the **card grid**, and only visible cards are mounted at any time.
* `pets__detail` is a hidden host where `PetDetailView` mounts when a card is opened.
* Fetches household via `getHouseholdIdForCalls()`.
* Calls `petsRepo.list(orderBy: "position, created_at, id")`.
* Stores results in local `pets` array.
* Calls `reminderScheduler.init()` and `reminderScheduler.scheduleMany()` to queue reminders for rendered pets.
* Calls `renderPets()` to generate card elements aligned with the Family card design tokens.

### 3.2 Virtualised grid renderer

* Maintains a recycled pool of `<div class="pets__card">` nodes, mirroring Family card behaviour for focus handling and spacing.
* Measures available width to determine columns, card dimensions, and spacer heights. Defaults: 320px height, 260px minimum width, 24px gaps.
* Applies the PR4 windowing logic: only cards intersecting the viewport plus an 8-row buffer render.
* Each card is marked `role="region"` with `aria-label="Pet card: <name>"`, falling back to “Unnamed pet”.
* Query matches update `<mark>` wrappers in the name/type fields to highlight search hits.
* `pets__grid` uses `loading="lazy"` on photos to protect scroll performance.

### 3.3 Card anatomy & media handling

```html
<div class="pets__card" role="region" aria-label="Pet card: Skye">
  <div class="pets__card-display">
    <div class="pets__media" data-state="ready|loading|placeholder">
      <img class="pets__photo" loading="lazy" alt="Skye" src="…" hidden>
      <img class="pets__placeholder" alt="" src="/assets/pets/placeholders/dog.svg">
    </div>
    <div class="pets__media-actions">
      <button class="pets__photo-action">Change photo</button>
      <button class="pets__photo-action pets__photo-action--reveal" aria-label="Reveal in folder">Reveal in folder</button>
    </div>
    <div class="pets__card-body">
      <h3 class="pets__name">Skye</h3>
      <p class="pets__type">Husky</p>
    </div>
    <div class="pets__actions">
      <button class="pets__action pets__action--primary">Open</button>
      <button class="pets__action">Edit</button>
      <div class="pets__order">
        <button class="pets__order-btn" aria-label="Move up">▲</button>
        <button class="pets__order-btn" aria-label="Move down">▼</button>
      </div>
    </div>
  </div>
  <form class="pets__card-editor" hidden>
    …
  </form>
</div>
```

* Species-specific placeholders (dog/cat/other) live under `src/assets/pets/placeholders/` and are inferred from `pet.species` or `pet.type`.
* When `image_path` is set, Tauri builds resolve to `attachments/<household_id>/pet_image/<relative>` via `canonicalizeAndVerify` + `convertFileSrc`, falling back to Blob URLs if direct loading fails.
* `Change photo` launches a single-file dialog for images only. The renderer reads the chosen file, copies it into `attachments/<household_id>/pet_image/`, generates a sanitised name, and then calls `petsUpdateImage`. On success `page.patchPet()` updates just that card.
* Guard failures call `presentFsError` (vault copy) and show a toast (`toast.show({ kind: "error", message: "Couldn’t update pet photo." })`).
* `Reveal` reuses the shared attachment opener for the `pet_image` category, matching Family’s “Reveal in folder” affordance.
* Arrow keys traverse cards, `Enter` opens details, `Escape` restores the grid, and focus rings reuse the Family card token.

### 3.4 Empty state

When no pets exist, `.pets__empty` displays “You haven’t added any pets yet. Each will appear here with their photo and details.”
The live region announces the change, and when filters hide matches the copy pivots to “No pets match… Clear the search to see everything.”

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
PetDetailView(section, pet, persist, showList, deps?);
```

Where:

* `section` — the main container,
* `pet` — the current object,
* `persist` — callback to push edits,
* `showList` — callback restoring list view,
* `deps` — optional overrides (e.g. `getHouseholdIdForCalls`) used in tests.

### 5.2 Layout

Rendered markup hierarchy (simplified):

```html
<section class="pet-detail">
  <header class="pet-detail__header">
    <button class="pet-detail__back">Back</button>
    <h1 class="pet-detail__title">Skye</h1>
  </header>

  <section class="pet-detail__identity">
    <div class="pet-detail__avatar">S</div>
    <div class="pet-detail__identity-body">
      <h2 class="pet-detail__name">Skye</h2>
      <p class="pet-detail__subtitle">Dog · Husky</p>
      <dl class="pet-detail__meta">
        <dt>Species</dt><dd>Dog</dd>
        <dt>Breed</dt><dd>Husky</dd>
        <dt>Birthday</dt><dd>12/01/2018</dd>
      </dl>
      <span class="pet-detail__age">5 years</span>
    </div>
  </section>

  <section class="pet-detail__section">
    <h3 class="pet-detail__section-title">Add medical record</h3>
    <form class="pet-detail__form">
      <div class="pet-detail__form-row">
        <label class="pet-detail__field">Date <input type="date" required></label>
        <label class="pet-detail__field">Description <textarea required></textarea></label>
      </div>
      <div class="pet-detail__form-row">
        <label class="pet-detail__field">Reminder <input type="date"></label>
        <label class="pet-detail__field">Attachment path <input type="text"></label>
      </div>
      <div class="pet-detail__actions">
        <button class="pet-detail__submit" type="submit" disabled>Add record</button>
      </div>
    </form>

    <h3 class="pet-detail__section-title">Medical history</h3>
    <div class="pet-detail__history">
      <p class="pet-detail__loading">Loading medical history…</p>
      <p class="pet-detail__empty" hidden>No medical records yet.</p>
      <div class="pet-detail__history-list" role="list">
        <article class="pet-detail__record" role="listitem">
          <header class="pet-detail__record-header">
            <time class="pet-detail__record-date">09/01/2025</time>
            <span class="pet-detail__record-reminder">Reminder 08/25/2025</span>
          </header>
          <p class="pet-detail__record-description">Vaccination booster</p>
          <div class="pet-detail__record-actions">
            <button class="pet-detail__record-action">Open</button>
            <button class="pet-detail__record-action">Reveal in Finder</button>
            <button class="pet-detail__record-delete">Delete</button>
          </div>
        </article>
      </div>
    </div>
  </section>
</section>
```

### 5.3 Identity panel

* Populated entirely from the cached `Pet` model — no extra IPC call.
* Shows name, species (`pet.species` or falls back to `pet.type`), breed, birthday, and an auto-computed age chip when the birthday is known.
* Avatar renders the first letter of the pet name for quick recognition.

### 5.4 Medical form

* Required fields: **Date** and **Description**. Submit button is disabled until both are populated.
* Optional fields: **Reminder** (validated to be on/after the visit date) and **Attachment path** (sanitised via `sanitizeRelativePath()` before persistence).
* The attachment input is normalised to NFC, trimmed, stripped of leading `/`, and rejected if it contains traversal (`./`, `../`), reserved names, or exceeds the max length enforced by the vault guard. Inline helper text surfaces the specific sanitiser error before any IPC call is attempted.
* Submissions call `petMedicalRepo.create()` with `category = "pet_medical"`, then bump `pets.updated_at` through `petsRepo.update()`.
* Success resets the form, focuses the date input, shows a success toast, emits `ui.pets.medical_create_success`, and re-renders the list with the new record optimistically prepended.
* Failures surface mapped error toasts (invalid household/category/path/file) and log `ui.pets.medical_create_fail { code }` for diagnostics. Vault guard rejections use the friendly copy listed in §5.5.3.

### 5.5 Medical history list

* Records load newest-first via `petMedicalRepo.list({ orderBy: "date DESC, created_at DESC, id" })` scoped to the active pet.
* Each card includes the visit date, optional reminder chip, description, and action buttons.
* Delete button disables during in-flight calls, invokes `petMedicalRepo.delete()`, refreshes the local list, emits success/failure logs, and mirrors the list back to the parent via `onChange()`.

#### 5.5.1 Attachment preview surface

* Each card renders a `160×160` reserved media box that lazy-loads a thumbnail using an `IntersectionObserver` once the card enters the viewport window.
* Thumbnails are requested through `thumbnails_get_or_create({ root_key, relative_path, max_edge: 160 })`. Successful responses resolve to a cached JPEG (`$APPDATA/attachments/.thumbnails/<sha1>.jpg`) that the UI displays via an `<img>` tag with aspect-fit styling.
* When the IPC call returns `{ ok: false, code: 'UNSUPPORTED' }`, the card shows the generic file icon instead of an image preview. Cache hits emit `ui.pets.thumbnail_cache_hit`; fresh renders log `ui.pets.thumbnail_built` with dimensions and build time.
* The lazy loader batches requests per animation frame to avoid layout thrash; cards outside the viewport never trigger thumbnail IPC work.

#### 5.5.2 Attachment actions & existence checks

* “Open” and “Reveal in Finder/Explorer” continue to call `openAttachment("pet_medical", id)` / `revealAttachment("pet_medical", id)`. Outcomes are logged through `ui.pets.attach_open` / `ui.pets.attach_reveal` with `{ path, result }`.
* On render, each card issues a lightweight `files_exists({ root_key, relative_path })` probe. A missing file toggles the card into the broken state: the thumbnail area shows a warning banner (“File not found.”) and a primary **Fix path** button.
* Broken cards emit `ui.pets.attachment_missing { medical_id, path }` exactly once per session so diagnostics capture how many attachments need repair.

#### 5.5.3 Fix path flow & messaging

* Clicking **Fix path** opens the vault-scoped file dialog seeded to `$APPDATA/attachments/`. The renderer re-runs `sanitizeRelativePath()` on the chosen file before calling `petMedicalRepo.update({ id, relative_path })`.
* Successful updates:
  * log `ui.pets.attachment_fix_opened` when the dialog appears and `ui.pets.attachment_fixed` once the IPC write resolves;
  * immediately patch the in-memory record and re-render only the affected card (the parent list and other cards keep their DOM identity);
  * invalidate the cached thumbnail (remove the local cache entry) and trigger a fresh `thumbnails_get_or_create` fetch.
* Guard failures bubble an `AppError` with codes mapped to friendly copy via `presentFsError`:

  | Code                     | Toast copy                                                                  |
  | ------------------------ | ---------------------------------------------------------------------------- |
  | `PATH_OUT_OF_VAULT`      | “That file isn’t inside the app’s attachments folder.”                       |
  | `PATH_SYMLINK_REJECTED`  | “Links aren’t allowed. Choose the real file.”                                |
  | `FILENAME_INVALID`       | “That name can’t be used. Try letters, numbers, dashes or underscores.”      |
  | `ROOT_KEY_NOT_SUPPORTED` | “This location isn’t allowed for Pets documents.”                            |
  | `NAME_TOO_LONG`          | “That name is too long for the filesystem.”                                  |

* The inline helper text near the attachment input mirrors these messages when sanitiser validation fails before IPC dispatch.

### 5.6 Focus & feedback

* Detail view snapshots the history scroll offset and focused button before mutations and restores them post-render so keyboard focus stays stable.
* After successful creates the date input regains focus; after deletes the scroll position is restored.
* All CRUD errors surface toasts (`toast.show({ kind: "error", … })`) with mapped copy, while successes emit lightweight confirmation toasts.
* Additional instrumentation:
  * `ui.pets.detail_opened { id }` when the drawer mounts.
  * `ui.pets.medical_delete_success` / `_fail` per deletion attempt.

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

* **Display:** name (with optional `<mark>` highlight) plus a pill showing `pet.type`, direct actions (`Open`, `Edit`), and an overflow menu for destructive affordances.
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
* The header renders a `Delete` / `Delete Permanently` toolbar next to the title. Buttons are conditionally visible based on the hard-delete flag and disable during pending requests to avoid double execution.

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
| Delete pet            | Confirmation modal, hides card on success, shows 10 s toast with “Restore”. |
| Delete permanently    | Requires typing confirmation, removes card immediately, no undo toast.    |
| Switch route          | View cleanups run; reminder timers persist by design.                     |

---

## 9. Keyboard and accessibility

* Rows are focusable (`role="listitem"`, `tabIndex` default from DOM). Arrow keys within the row editor move focus naturally via standard form controls.
* Search input has `aria-label="Search pets"` for screen readers.
* Banner updates set `aria-label="Pets banner"` and toggle `aria-hidden` appropriately.
* Keyboard shortcuts for delete actions (`Cmd/Ctrl+Backspace`, `Cmd/Ctrl+Shift+Backspace`) remain behind a developer flag and are tracked in the rollout checklist before enabling by default.


## 10. Delete flows

* **Card menu actions:** the `⋯` overflow renders `Delete` and, when `ENABLE_PETS_HARD_DELETE` resolves true, `Delete Permanently`. The two buttons are separated by a divider and mirror the detail toolbar.
* **Soft delete:** `Delete` opens a confirmation modal (“Delete {name}? You can restore from Trash.”). On confirm we call `petsRepo.delete()`, optimistically remove the pet from the virtualised list, cancel reminder timers, and raise an info toast with a 10 second “Restore” action. Undo invokes `petsRepo.restore()`, reinserts the cached pet at its previous index, reschedules reminders, and logs `ui.pets.restored`.
* **Hard delete:** `Delete Permanently` requires typing the pet’s name (or ID if unnamed) before enabling confirmation. Successful confirmation logs `ui.pets.delete_hard_confirmed`, calls `petsRepo.deleteHard()`, closes any open detail view, and emits a success toast without undo. Failures surface errors and keep the card visible.
* **Detail parity:** `PetDetailView` exposes the same buttons in a right-aligned toolbar. They dispatch the shared handlers and close the detail view after a delete succeeds.
* **Telemetry:** the UI emits `ui.pets.delete_soft_clicked`, `ui.pets.deleted_soft`, `ui.pets.restore_clicked`, `ui.pets.restored`, `ui.pets.delete_hard_clicked`, `ui.pets.delete_hard_confirmed`, `ui.pets.deleted_hard`, and failure variants. These align with the IPC commands documented in `docs/pets/ipc.md`.
* **Guardrails:** hard delete availability remains feature-flagged, the undo window expires automatically, and file cleanup is best-effort—DB deletion still commits even if vault removal fails.
