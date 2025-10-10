# Pets PR4 — List UX + Right-Edge Banner Slot (P3 minimal)

### Objective

Deliver a **persistent Pets page shell** with a **right-edge vertical banner**, **inline create**, **virtualised list**, and **search**.
Must meet perf/UX bars:

* **1k pets scrolls under 25% CPU** (steady-state while scrolling on macOS).
* **Create/Edit does not full-rerender** the page; only targeted DOM updates occur.

No schema changes.

---

## 1) Scope & intent

**In scope**

* Persistent shell for `/pets` (no wholesale `section.innerHTML = …` on every change).
* Right-edge **vertical banner slot** bound to route `pets`.
* **Inline create** (add pet at top/bottom without reloading list).
* **Virtualised list** (windowed rendering, stable heights).
* **Search** (client-side, debounced, case-insensitive, matches name/type/breed).
* Incremental DOM updates for **edit** (rename/type change) without destroying row nodes.
* Perf instrumentation hooks.

**Out of scope**

* Detail pane redesign, reminder UX, thumbnails, drag-reorder.

---

## 2) Deliverables

| Deliverable               | Description                                                                      |
| ------------------------- | -------------------------------------------------------------------------------- |
| **Persistent page shell** | `PetsPage` component that mounts once; internal regions update incrementally.    |
| **Banner integration**    | Right-edge banner bound to `pets` via existing `updatePageBanner.ts`.            |
| **Virtualised list**      | Windowed renderer for rows; supports ≥1000 items smoothly.                       |
| **Inline create**         | Form inserts new row without reloading or re-mounting the list.                  |
| **Search bar**            | Debounced filter (200 ms), highlights matches (non-destructive).                 |
| **Edit-in-place**         | Name/type edits patch a single row; no list rebuild.                             |
| **Perf hooks**            | `PerformanceObserver` + RAF metrics; console + JSON log of scroll/update costs.  |
| **Tests**                 | UI perf harness (1k fixture), list stability tests, search correctness.          |
| **Docs**                  | Update `docs/pets/ui.md` (list/creation/search/virtualisation) and banner notes. |

---

## 3) Detailed tasks

### 3.1 Persistent shell

* Create `src/ui/pets/PetsPage.ts` with stable DOM regions:
  * `header` (title + search + inline create)
  * `listViewport` (scroll container)
  * `listSpacer` (for virtualisation)
* Replace `PetsView` wholesale `innerHTML` writes with **node reuse**:
  * Initial mount builds shell once.
  * Subsequent updates call `renderWindow()` to patch only visible rows.

### 3.2 Right-edge banner slot

* On route `#/pets`, call `updatePageBanner('pets')`.
* Asset (per repo notes): `src/assets/banners/pets/pets.png`.
* Ensure banner container (far-right vertical strip) is **sticky** top-to-bottom and non-interactive.

### 3.3 Virtualised list

* Implementation: fixed row height (tokenised, e.g., `--row-h: 56px`), window buffer of ±8 rows.
* Maintain:
  * `scrollTop` → `firstIndex = floor(scrollTop / rowH) - buffer`
  * `visibleCount = ceil(viewportH / rowH) + 2*buffer`
  * `spacerTop = firstIndex * rowH`, `spacerBottom = (total - lastIndex - 1) * rowH`
* Reuse row elements (pool) to avoid GC churn.
* Keyboard nav (Up/Down) operates within visible window.

### 3.4 Inline create

* Form in header:
  * Fields: **Name** (required), **Type** (optional).
  * On submit:
    * Call `petsRepo.create()`; **append to data model**.
    * **Patch list**: if new row falls inside current window, create exactly **one** row node; else adjust spacer and counts only.
    * Do **not** rebuild shell or re-mount viewport.
  * Clear inputs; keep focus on Name.

### 3.5 Edit-in-place

* Row actions:
  * Click “Edit” toggles inline inputs for name/type.
  * On save: `petsRepo.update()` then **update that row node** (no list redraw).
  * On cancel: restore text content only.

### 3.6 Search

* Input in header (`placeholder: "Search pets…"`).
* Debounce 200 ms; filter on `name | type | breed` (case-insensitive, simple `.includes` on NFC-normalised strings).
* Search affects **data view**, not source array; virtualiser computes counts from filtered array.
* Optional highlight `<mark>` around matched substring in name/type.

### 3.7 Performance instrumentation

* Add `perf.pets.window_render` logs:
  * fields: `rows_rendered`, `duration_ms`, `from_idx`, `to_idx`.
* `PerformanceObserver` around `renderWindow()`; expose a dev toggle `?perf=1` to print to console.
* One RAF per scroll frame; coalesce bursts.

### 3.8 Styles

* Use existing tokens (`--space-*`, `--radius-*`, Inter font).
* Row: single-line name + type pill; overflow ellipsis.
* Ensure row height **constant** to keep virtualiser predictable.
* Search and Create occupy header; banner consumes far-right rail.

---

## 4) Tests

### 4.1 Perf harness (1k items)

* Seed 1000 pets (deterministic names).
* Simulate continuous scroll over full list; record average CPU proxy:
  * `renderWindow()` avg `duration_ms` < 6 ms per frame.
  * No forced synchronous layout warnings.
* Assert **no more than window size + buffer** DOM nodes exist at any time.

### 4.2 Create/Edit behaviour

* **Create**:
  * After submit, **rows_rendered delta ≤ 1** if new row visible; 0 otherwise.
  * List spacer/indices update; **no shell remount**.
* **Edit**:
  * Only the target row’s text nodes change; DOM node identity stable (`isSameNode` true).

### 4.3 Search correctness

* “sk” matches “Skye”, “bosky”, case-insensitive.
* Clearing search restores baseline count; scroll window re-computes.

### 4.4 Stability

* Rapid scroll + search typing → no exceptions; window renderer never exceeds 1 RAF per frame.

---

## 5) Acceptance checklist (must all pass)

| Condition                                               | Status | Evidence                            |
| ------------------------------------------------------- | ------ | ----------------------------------- |
| Persistent shell; no full rerender on create/edit       | ☐      | DOM node identity snapshots         |
| Right-edge banner visible on `/pets`                    | ☐      | Visual check; banner path correct   |
| Virtualised list active (≤ ~120 nodes live for 1k set)  | ☐      | DOM inspection                      |
| 1k pets scroll < **25% CPU** steady-state               | ☐      | Perf logs / manual Activity Monitor |
| Create adds row without list remount                    | ☐      | Render diff shows ≤1 node added     |
| Edit patches text without list rebuild                  | ☐      | `isSameNode` checks                 |
| Search filters + highlights; debounce works             | ☐      | Test harness pass                   |
| Perf logs emitted (`perf.pets.window_render`)           | ☐      | `arklowdun.log` samples             |
| Docs updated (`ui.md`) to reflect virtualisation/search | ☐      | Commit diff                         |

---

## 6) Verification workflow

1. Launch with perf flag:

   ```bash
   npm run tauri dev -- --pets-perf
   ```
2. Seed 1000 pets; open `/pets`.
3. Scroll top → bottom → top; observe:
   * Window render logs average under ~6 ms.
   * Activity Monitor shows process under **25% CPU** while scrolling.
4. Create “Nova” → confirm single node insertion if in view.
5. Edit “Skye” → “Skye (Husky)” → node identity unchanged.
6. Search “sky” → filtered list; clear search → restored counts.
7. Navigate away/back → banner reflects `/pets`; shell persists; list rehydrates without full rebuild.

---

## 7) Risks & mitigations

| Risk                                | Mitigation                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| Row height drift breaks virtualiser | Lock row height via CSS and content clamps; test for overflow.                |
| Excess GC from node churn           | Node pooling + patch-in-place updates only.                                   |
| Search causes thrash                | Debounce + compute on filtered array; avoid re-allocating large strings.      |
| Banner asset missing                | Build fails fast on asset import; add test that `bannerFor('pets')` resolves. |
| Full rerender sneaks back in        | Guard against `section.innerHTML=` paths; code review checklist.              |

---

## 8) Documentation updates required

| File                          | Update                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `docs/pets/ui.md`             | Add sections: **Virtualised List**, **Inline Create**, **Search**, **Banner Rail**. |
| `docs/pets/architecture.md`   | Note persistent shell vs legacy innerHTML swapping.                                 |
| `docs/pets/diagnostics.md`    | Add `perf.pets.window_render` example log lines.                                    |
| `docs/pets/plan/checklist.md` | Tick PR4 on merge with perf evidence screenshots/metrics.                           |
| `CHANGELOG.md`                | “PR4 – Pets list UX (banner, virtualisation, inline create, search).”               |

---

## 9) Sign-off

| Role          | Name              | Responsibility                                      |
| ------------- | ----------------- | --------------------------------------------------- |
| **Developer** | Ged McSneggle     | Implement shell, virtualiser, search, inline create |
| **Reviewer**  | Paula Livingstone | Perf/UX verification and banner alignment           |
| **CI**        | Automated         | UI tests on seeded 1k set; lint/build               |

---

**Status:** Ready for implementation
**File:** `/docs/pets/plan/pr4.md`
**Version:** 1.0
**Scope:** Minimal P3 delivery: persistent shell, right-edge banner slot, virtualised list, inline create, and search — hitting the CPU ceiling and no full rerenders on create/edit.
