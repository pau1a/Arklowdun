Search & Import Roadmap — Mandate (Hardening Path)

> **Scope lock:** This document captures the current state, invariants, and the **ordered PR queue** to finish and harden Search + Import. Paste this file into the repo (e.g. `docs/roadmap/search-import.md`) and work PRs in the order below.

---

## 1) Current State (truths)

- **Importer**
  - Lives under **Settings → “Import legacy data…”** (modal).
  - Emits JSONL logs with fields: `ts` (RFC3339 millis, UTC), `level`, `event`, `seq`, `fields{…}`.
  - Progress events: `import://started`, `import://progress` (`step_start`/`step_end`), terminals `import://done` | `import://error`.
  - Log retention: count-based via `IMPORT_LOG_RETENTION`. Cross-platform open via `open_path` IPC.

- **Search**
  - Sidebar **omnibox** is active; no topbar remains.
  - Backend `search_entities` returns **Files (index preferred)**, **Events**, **Notes**, **Vehicles**, **Pets**.
  - Vehicles/Pets use **dynamic column coalescing** (no schema migration).
  - Ordering is **deterministic**: `score DESC, timestamp DESC, insertion ordinal ASC`.
  - Frontend blocks queries `< 2` chars (one-char exception exists **only** on backend for filename prefix when `files_index` exists).
  - A11y: `role=listbox/option`, `aria-selected`, shared `aria-live` region wired.
  - Keyboard: Up/Down/Enter works in **sidebar dropdown**. **Command palette** not built yet.
  - Positioning: results are `position: fixed`, recompute on resize/scroll.
  - Tokens: `--radius-sm: 6px` present; inputs inherit.
  - Still using `COALESCE(events.tz,'Europe/London')`; household fallback not implemented.
  - Indices not added yet for `events(household_id, title)` and `notes(household_id, updated_at)`.

---

## 2) Invariants (do not regress)

- **Query semantics:** case-insensitive (`COLLATE NOCASE` everywhere); exact match scores higher than partial.
- **Short queries:** frontend min length = 2; backend allows 1-char **only** for filename prefix when `files_index` exists.
- **Files path:** prefer `files_index` over any legacy `files` table; quietly skip if index/table absent.
- **Accessibility:** keep roles, `aria-selected`, and `aria-live` announcements.
- **IPC discipline:** all OS actions through commands (e.g., `open_path`), not direct plugin calls from UI.

---

## 3) Immediate Hotfix (PR-13a-HF) — Results panel chrome & anchoring

**Branch:** `pr/13a-hotfix-omnibox-ui`  
**Goal:** Fix visual jank: ensure the dropdown renders with background, border/shadow, correct z-index, and is anchored beside the sidebar input.

### Tasks
- **CSS (new or extend):**
  ```css
  .omnibox { position: relative; padding: var(--space-2) var(--space-3); }
  .omnibox input[type="search"] { width: 100%; height: 34px; }

  .omnibox__results {
    position: fixed;
    /* These are recomputed in JS via getBoundingClientRect(); CSS is a safe default. */
    top: 64px;
    left: 200px; /* sidebar width */
    width: 520px;
    max-height: 420px;
    overflow-y: auto;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-base);
    z-index: 200; /* above content, below modals */
  }

  .omnibox__results[hidden] { display: none; }

  .omnibox__results ul { list-style: none; margin: 0; padding: 0; }
  .omnibox__results li {
    display: grid;
    grid-template-columns: 24px 1fr auto;
    gap: 8px;
    padding: 8px 10px;
    align-items: center;
  }
  .omnibox__results li[aria-selected="true"] {
    background: var(--color-row-hover);
  }
  .omnibox__load-more {
    padding: 10px; text-align: center; cursor: pointer; border-top: 1px solid var(--color-border);
  }
````

* **TS (positioning):** On input focus/type/resize/scroll, compute:

  ```ts
  const r = input.getBoundingClientRect();
  panel.style.top  = `${Math.round(r.bottom + 4)}px`;
  panel.style.left = `${Math.round(r.right + 8)}px`; // or sidebar.right
  panel.style.width = '520px';
  panel.hidden = false;
  ```
* **Z-index sanity:** Ensure modals use a higher layer (e.g., 900+) so dropdown doesn’t overlay.

### Acceptance

* Typing shows a bordered, shadowed list **adjacent** to the sidebar, not floating mid-content.
* List remains visible on scroll and adjusts on resize.
* Keyboard navigation visuals are clear (hover/active row).

---

## 4) Ordered PR Queue (after hotfix)

1. **PR-13d — Engine Hygiene & Predictability**

   * **Branch:** `pr/13d-search-hygiene`
   * **Tasks:** Add 30s micro-cache in `searchRepo.ts`; centralize `table_exists` helper; keep “Load more” rule; optional TODO for household tz fallback.
   * **Acceptance:** Same results, fewer identical round-trips; no regressions.

2. **PR-13b — Command Palette (⌘/Ctrl+K)**

   * **Branch:** `pr/13b-command-palette`
   * **Tasks:** Modal overlay with input + results; ⌘/Ctrl+K toggle; Esc/backdrop close; reuse omnibox renderer.
   * **Acceptance:** Works across views; no console errors; shares A11y.

3. **PR-13e — Files Index & Rebuild Tooling**

   * **Branch:** `pr/13e-files-index`
   * **Tasks:** Migration for `files_index`; dev-only rebuild command with progress/logs; prefer index in search.
   * **Acceptance:** Fast filename prefix search at \~10k rows; no regressions if index absent.

4. **PR-13i — Search Tests & Perf Guardrails**

   * **Branch:** `pr/13i-search-tests`
   * **Tasks:** Rust integration tests (exact vs partial, ordering, short-query bypass); debug perf timers.
   * **Acceptance:** Tests green; no behavior change.

5. **PR-13h — Result Highlighting**

   * **Branch:** `pr/13h-result-highlighting`
   * **Tasks:** Sanitize then wrap matched substrings in `<mark>`; maintain contrast; no HTML leakage.
   * **Acceptance:** Highlights visible and safe.

---

## 5) Definition of Done (each PR)

* Code compiles (`cargo build`, `npm build`).
* `npm run check-all` is green.
* No console errors; no new Tauri invoke warnings.
* Accessibility intact (roles, aria-live, keyboard flow).
* Docs updated when applicable.

---

## 6) Documentation To Keep In Sync

* `docs/search.md`: covers Vehicles/Pets, ordering, short-query rules, files\_index. Add rebuild instructions after 13e.
* `docs/importer.md`: new doc for importer schema, events, retention, opening logs.

---

## 7) Risk Notes

* Dropdown anchoring is the top user-facing risk; fix in PR-13a-HF immediately.
* Files index is dev-only initially; keep button in Settings → Diagnostics clearly labeled.
* Highlighting must sanitize before wrapping to prevent XSS.

---

## 8) Ownership & Branching

* Each PR uses its own `pr/<id>-<slug>` branch off `main`.
* Merge sequentially in the order defined above.
* Use the JSON log format consistently for new instrumentation.

---

## 9) Appendix — Sample Importer Log Line

```json
{
  "ts": "2025-09-10T12:22:24.269Z",
  "level": "info",
  "event": "step_end",
  "seq": 7,
  "step": "normalize",
  "duration_ms": 0,
  "fields": {}
}
```
