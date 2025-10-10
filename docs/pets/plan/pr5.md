# Pets PR5 — Detail View Core (P4, First Pass)

### Objective

Deliver the core **Detail View** experience for the Pets domain:

* **Identity panel** showing key pet metadata.
* **Medical tab** with full CRUD for medical records (newest-first).
* **Attachment open/reveal** via the existing vault guards.
* **Error toasts** surfaced for all repo and attachment faults.

**Done means:** a full *create → attach → delete* cycle in the Medical tab works end to end with keyboard focus retention and without the page resetting.

---

## 1) Scope & Intent

**In scope**

* `PetDetailView` rendered from row “Open” action in list.
* Identity header (name, species, breed, age, birthday).
* Medical tab with:

  * Table of records (newest first).
  * Add form (date, description, optional reminder, optional file attach).
  * Delete and open/reveal actions.
* Integration with existing repos (`petsRepo`, `petMedicalRepo`).
* Error toasts and validation guard feedback.
* Focus and scroll retention across CRUD operations.

**Out of scope**

* Reminder engine redesign (already PR3).
* Thumbnails or image uploads (future PR).
* Banner/side-rail styling changes (those remain from PR4).

---

## 2) Deliverables

| Deliverable                 | Description                                                         |
| --------------------------- | ------------------------------------------------------------------- |
| **PetDetailView component** | React/TSX (or template-based) view handling identity + tabs.        |
| **Medical tab CRUD**        | Full create/read/delete pipeline; update local model in place.      |
| **Attachment integration**  | “Open” and “Reveal in Finder” buttons wired to vault helpers.       |
| **Error toasts**            | `presentFsError` and generic `showError()` invoked on all failures. |
| **Focus retention**         | Cursor remains in the add form field after create/delete.           |
| **Docs**                    | Update `/docs/pets/ui.md` with detail layout and CRUD flows.        |

---

## 3) Detailed Tasks

### 3.1 Shell

* Extend the persistent `/pets` page to include a **drawer or overlay** detail view, opened when a list row’s “Open” button is clicked.
* The drawer retains the right-edge banner from PR4.
* Mount point: `src/ui/pets/PetDetailView.ts`.
* Cleanly disposes on “Back”.

### 3.2 Identity panel

* Fields displayed (read-only in this pass):

  * `Name`, `Species`, `Breed`, `Birthday`, `Age` (auto-calculated from birthday).
* Pulls data from cached pet model (no extra IPC hit).
* Header layout: avatar placeholder (round), name/breed block, and age chip.

### 3.3 Medical tab CRUD

#### Layout

* Top: “Add Record” form.

  * Fields:

    * **Date** (required)
    * **Description** (required)
    * **Reminder date** (optional)
    * **Attach document** (optional path picker)
  * Submit button inline; disabled until required fields valid.
* Below: “Medical History” list (newest first), each entry as a card.

#### CRUD flow

* **Create**

  * On submit:

    * Validate input.
    * Call `petMedicalRepo.create()` with household_id, pet_id, and sanitized relative path.
    * On success, prepend record to list (`unshift`), maintaining newest-first.
    * Reset form, return focus to date field.
  * On failure, toast error; form remains populated for retry.
* **Delete**

  * “Delete” button on each card → calls `petMedicalRepo.delete(id)`.
  * On success, remove record from list without re-rendering full view.
  * Maintain scroll offset and selection.
* **Read**

  * List initialised newest-first via `ORDER BY date DESC, created_at DESC`.
* **Attachments**

  * When `relative_path` exists:

    * “Open” → `openAttachment(category="pet_medical", relative_path)`.
    * “Reveal” → `revealAttachment(category="pet_medical", relative_path)`.
  * Handle all errors with `presentFsError`.

### 3.4 Validation & toasts

* Required fields: `date`, `description`.
* Optional: `reminder_at`, `relative_path` (validated via `sanitizeRelativePath`).
* On backend validation error:

  * Catch code from `AppError`; display mapped message via toast.
  * Known codes: `INVALID_HOUSEHOLD`, `INVALID_CATEGORY`, `PATH_OUT_OF_VAULT`, `FILENAME_INVALID`.
* For unknown errors: generic “Could not save record” toast.

### 3.5 Focus retention

* After successful create:

  * `focus()` back to first field (`#medical-date`).
* After delete:

  * Preserve scroll position and focused element if within viewport.
* Handle with simple state snapshot (`scrollTop`, active element) before DOM mutation.

### 3.6 Logging

| Event                            | Fields           |
| -------------------------------- | ---------------- |
| `ui.pets.detail_opened`          | `id`             |
| `ui.pets.medical_create_success` | `id`, `pet_id`   |
| `ui.pets.medical_create_fail`    | `code`           |
| `ui.pets.medical_delete_success` | `id`, `pet_id`   |
| `ui.pets.medical_delete_fail`    | `code`           |
| `ui.pets.attach_open`            | `path`, `result` |
| `ui.pets.attach_reveal`          | `path`, `result` |

Logs route to `arklowdun.log` with standard rotation.

---

## 4) Tests

### 4.1 Unit tests

* Mock `petMedicalRepo` and verify:

  * Create adds record (list count +1, first item = new).
  * Delete removes record (count −1).
  * Toast shown on error.
  * Focus returns to form.
  * Attachment open/reveal call correct helpers.

### 4.2 Integration tests

* End-to-end simulated flow:

  * Open pet → create record → attach → delete → back.
  * Assert no full view remount (`PetDetailView` DOM node identity stable).
  * Assert focus restored to form input.

### 4.3 Perf regression

* 50 record scroll ≤ 5 ms per frame (same virtualization rules as PR4).
* No event listeners leak across open/close cycles.

---

## 5) Acceptance Checklist

| Condition                                           | Status | Evidence                |
| --------------------------------------------------- | ------ | ----------------------- |
| Detail view opens/closes without full-page rerender | ☐      | DOM diff                |
| Identity panel shows all fields                     | ☐      | Visual QA               |
| Medical CRUD (create, delete) works                 | ☐      | Manual + tests          |
| Attachments open/reveal functional                  | ☐      | Manual test             |
| Errors surface as toasts                            | ☐      | Screenshot/log          |
| Focus retained post-create/delete                   | ☐      | Integration test        |
| Logs emitted per event type                         | ☐      | `arklowdun.log` entries |
| Docs updated (`ui.md`, `diagnostics.md`)            | ☐      | Commit diff             |

---

## 6) Verification Workflow

1. Navigate to `/pets`, open a pet.
2. Observe header populated with metadata.
3. Add new medical record with file attach.
4. After submit, record appears at top, focus returns to date input.
5. Delete record — scroll position and focus unchanged.
6. “Open” attachment → confirm file opens; “Reveal” → Finder window opens.
7. Kill DB connection mid-create → toast error, form preserved.
8. Close detail → reopen → state consistent, scroll unchanged.

---

## 7) Risks & Mitigations

| Risk                               | Mitigation                                    |
| ---------------------------------- | --------------------------------------------- |
| Full redraw on CRUD                | Patch DOM incrementally; reuse list nodes.    |
| Focus lost on re-render            | Cache and restore active element post-update. |
| Attachment handler exceptions      | Wrap in try/catch with `presentFsError`.      |
| Backend lag triggers double insert | Disable submit until promise resolves.        |
| Scroll-jump after delete           | Manual `scrollTo(scrollTop)` restore.         |

---

## 8) Documentation Updates Required

| File                          | Update                                                         |
| ----------------------------- | -------------------------------------------------------------- |
| `docs/pets/ui.md`             | Add “Detail View” and “Medical Tab” sections.                  |
| `docs/pets/diagnostics.md`    | Add `ui.pets.medical_*` log examples.                          |
| `docs/pets/ipc.md`            | Note CRUD call paths and expected payloads.                    |
| `docs/pets/plan/checklist.md` | Mark PR5 complete post-verification.                           |
| `CHANGELOG.md`                | “PR5 – Detail View core implemented: identity + medical CRUD.” |

---

## 9) Sign-off

| Role          | Name              | Responsibility                                                   |
| ------------- | ----------------- | ---------------------------------------------------------------- |
| **Developer** | Ged McSneggle     | Implements detail drawer, CRUD, attachments, and focus retention |
| **Reviewer**  | Paula Livingstone | Tests create→attach→delete end-to-end                            |
| **QA/CI**     | Automated         | Runs UI + focus retention tests on macOS                         |

---

**Status:** Ready for implementation
**File:** `/docs/pets/plan/pr5.md`
**Version:** 1.0
**Scope:** Implements the core Pets detail experience — identity panel, full medical CRUD with attachment handling, error toasts, and stable focus retention across all user operations.

