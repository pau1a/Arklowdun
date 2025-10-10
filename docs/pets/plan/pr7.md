# Pets PR7 — Ordering, Palette, Shortcuts (P6 + P7 basics)

### Objective

Ship **deterministic ordering**, **command-palette entry**, and **keyboard shortcuts** across the Pets list and detail views.

**Done means:**

* **Positions persist across reload.**
* **Keyboard-only create/edit/back works** using `N`, `/`, `Esc`, and `Cmd/Ctrl+Enter`.

No schema changes.

---

## 1) Scope & intent

**In scope**

* **Reorder** Pets list (writes `position` per household; no full rerender).
* **Command palette**: ensure Pets is discoverable and opens the pane; add “New Pet…” action.
* **Keyboard shortcuts**:

  * `N` — New Pet (inline create focus in list; new medical record in detail when the Medical tab is active).
  * `/` — Focus search field in list.
  * `Esc` — In detail: back to list; in list: clears search or blurs create form.
  * `Cmd/Ctrl + Enter` — Submit active form (create/edit medical or pet edit).
* Logging, diagnostics counters, and tests.

**Out of scope**

* Drag-reorder by mouse with fancy visuals (minimal row grab is acceptable).
* Any palette redesign; reuses global palette plumbing.

---

## 2) Deliverables

| Deliverable               | Description                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| **Reorder API**           | Incremental `position` updates persisted via `petsRepo.update({ id, position })`.              |
| **Row move UI**           | Minimal keyboard + click affordances: Up/Down move; optional compact handles for mouse.        |
| **Command palette hooks** | Entries: “Open: Pets” (hash `#/pets`) and “Pets: New Pet…”.                                    |
| **Shortcut bindings**     | Global(ish) handlers with scope guards for `N`, `/`, `Esc`, `Cmd/Ctrl+Enter`.                  |
| **Persistence**           | After reorder + reload, order is unchanged (verified).                                         |
| **Tests**                 | Reorder persistence, palette opens, shortcuts operate without mouse.                           |
| **Docs**                  | Update `docs/pets/ui.md` (ordering, palette, shortcuts) and `docs/pets/diagnostics.md` (logs). |

---

## 3) Detailed tasks

### 3.1 Ordering model

* **Ordering rule:** `ORDER BY position, created_at, id` (already enforced by queries).

* **Positions are 0-based** and contiguous within a household.

* **Move operations**:

  * Keyboard on focused row:

    * `Alt/Option + ↑` → move up one.
    * `Alt/Option + ↓` → move down one.
  * Click affordances: tiny ▲/▼ buttons visible on row hover (no layout shift).

* **Write path:** swap two rows’ `position` values locally, optimistically update the view, then call:

  ```ts
  await petsRepo.update({ id: a.id, position: a.position });
  await petsRepo.update({ id: b.id, position: b.position });
  ```

  * On failure: revert from pre-op snapshot and show toast.

* **Virtualised list integration:** moving an item **does not** rebuild the list. We:

  * Update source array order,
  * Recompute window indices,
  * Patch only affected row nodes.

* **Normalization:** after batch moves (rare), normalize positions to `0..N-1`.

### 3.2 Command palette entries

* **Open: Pets**

  * `kind: "Pane"`, icon `fa-paw`, action → set hash `#/pets` and focus search (`/`).
* **Pets: New Pet…**

  * `kind: "Action"`, when active route is not `/pets` it first navigates; then focuses the **Name** field in the inline create.

Palette item IDs:

* `cmd.pets.open`
* `cmd.pets.new`

### 3.3 Keyboard shortcuts

Scoping rules to avoid collisions:

* Ignore shortcuts when **focused inside a textarea** or any `[contenteditable]`.
* Respect modal focus traps if any are open.

Bindings:

* **`N`**

  * In **list**: focus **Name** in inline create.
  * In **detail** (Medical tab active): focus **Date** in “Add Record.”
* **`/`**

  * In **list**: focus search input; prevent default browser Find.
* **`Esc`**

  * In **detail**: trigger “Back” (return to list), retaining list scroll.
  * In **list**: clear search if not empty; else blur active field.
* **`Cmd/Ctrl + Enter`**

  * Submit **current** form: inline create (list) or add medical (detail).
  * If form invalid, flash validation state and keep focus.

Implementation: extend `initKeyboardMap` with route-aware handlers; register on mount, deregister on unmount.

### 3.4 Focus & scroll retention

* Maintain `scrollTop` of list and restore after any move or back-from-detail.
* Keep **row focus** on the moved item; use `tabindex="0"` + `focus()` after DOM patch.
* Prevent scroll jump by batching DOM writes in a single RAF.

### 3.5 Logging

Emit structured logs:

| Event                     | Fields                      |
| ------------------------- | --------------------------- |
| `ui.pets.order_move`      | `id`, `from`, `to`, `total` |
| `ui.pets.order_persist`   | `changed: number`           |
| `ui.pets.order_revert`    | `reason`                    |
| `ui.pets.palette_open`    | `id: "cmd.pets.open"`       |
| `ui.pets.palette_new`     | `id: "cmd.pets.new"`        |
| `ui.pets.kbd_shortcut`    | `key`, `scope`              |
| `ui.pets.form_submit_kbd` | `form`, `valid`             |

### 3.6 Diagnostics

Add counters to diagnostics export:

```json
"pets": {
  "ordering_moves":  count,
  "palette_invocations": count,
  "kbd_submissions": count
}
```

---

## 4) Tests

### 4.1 Ordering persistence

* Seed 10 pets, random order.
* Move item 8 → 2, reload route, assert order stable and `position` contiguous.
* Fail the second `update` call → expect revert and toast.

### 4.2 Virtualised correctness

* With 1000 pets:

  * Move an off-screen item upward by 50 positions.
  * Verify only **window bounds** re-render; DOM nodes ≤ window + buffer.

### 4.3 Palette

* Trigger `cmd.pets.open` → route set to `#/pets`, search focused.
* Trigger `cmd.pets.new` from dashboard → navigates then focuses create **Name**.

### 4.4 Shortcuts

* **List**: `N` focuses create, `/` focuses search, `Cmd/Ctrl+Enter` submits create if valid.
* **Detail**: `N` focuses medical Date, `Esc` goes back (list scroll unchanged), `Cmd/Ctrl+Enter` submits medical form.

### 4.5 Accessibility sanity

* Focus outline visible on moved row, buttons, and inputs.
* Arrow reordering reachable via keyboard only (no mouse required).

---

## 5) Acceptance checklist

| Condition                                                | Status | Evidence                      |
| -------------------------------------------------------- | ------ | ----------------------------- |
| Reorder persists across reload (contiguous positions)    | ☐      | SQL/IPC proof + manual reload |
| Virtualised list doesn’t full-rebuild on move            | ☐      | DOM node count stable         |
| Palette entries: open & new behave as specified          | ☐      | Manual + logs                 |
| `N`, `/`, `Esc`, `Cmd/Ctrl+Enter` work in correct scopes | ☐      | Keyboard-only walkthrough     |
| Focus & list scroll retained after back/move             | ☐      | Integration test              |
| Logs present (`ui.pets.order_*`, `ui.pets.kbd_*`)        | ☐      | `arklowdun.log` samples       |
| Docs updated (`ui.md`, `diagnostics.md`)                 | ☐      | Commit diff                   |

---

## 6) Verification workflow

1. Open `/pets` with 100+ items; move several rows via `Alt+↑/↓`.
2. Reload route → confirm order persisted, positions contiguous.
3. Hit `/` → search focused; type filter; `Esc` clears.
4. Hit `N` → create form focused; enter data; `Cmd/Ctrl+Enter` submits; new row appears without full rerender.
5. Open a pet; `N` focuses medical add; `Cmd/Ctrl+Enter` submits; `Esc` returns to list with scroll unchanged.
6. Use command palette to open Pets, then run “New Pet…” — field focused as expected.

---

## 7) Risks & mitigations

| Risk                               | Mitigation                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| Position drift after many moves    | Normalize positions periodically; write only changed rows.                         |
| Shortcut conflicts                 | Scope handlers by route and by focused element type; prevent default where needed. |
| Virtualiser + move edge cases      | Clamp indices; recalc spacer heights before painting.                              |
| Double-submit via `Cmd/Ctrl+Enter` | Disable submit button while pending promise.                                       |

---

## 8) Documentation updates required

| File                          | Update                                                                     |
| ----------------------------- | -------------------------------------------------------------------------- |
| `docs/pets/ui.md`             | New sections: **Reordering**, **Command Palette**, **Keyboard Shortcuts**. |
| `docs/pets/diagnostics.md`    | Add ordering/palette/keyboard log examples and counters.                   |
| `docs/pets/plan/checklist.md` | Mark PR7 upon merge with evidence.                                         |
| `CHANGELOG.md`                | “PR7 – Ordering, palette, and keyboard shortcuts for Pets.”                |

---

## 9) Sign-off

| Role          | Name              | Responsibility                                         |
| ------------- | ----------------- | ------------------------------------------------------ |
| **Developer** | Ged McSneggle     | Implement ordering writes, palette hooks, shortcut map |
| **Reviewer**  | Paula Livingstone | Verify persistence and keyboard-only flows             |
| **CI**        | Automated         | UI + virtualisation stability tests on macOS           |

---

**Status:** Ready for implementation
**File:** `/docs/pets/plan/pr7.md`
**Version:** 1.0
**Scope:** Reorder that sticks, palette entries that open and create, and a keyboard-only workflow that actually works.
