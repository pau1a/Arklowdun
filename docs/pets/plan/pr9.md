# Pets PR9 — Accessibility, Copy & Banners Final (P7 polish + P10)

### Objective

Bring the **Pets** feature to visual and accessibility parity with the rest of Arklowdun.
This pass finalises **AA-level contrast**, **focus visibility**, **ARIA navigation landmarks**, **user-friendly copy**, and **theme-aware vertical banners** for the `/pets` pane.

**Done means**

* Screen readers correctly announce section and state changes.
* All text and controls pass WCAG AA contrast ratios.
* Light/dark vertical banners swap instantly on theme change with **no layout shift** or jitter.
* Empty/error states present clear, friendly copy.

---

## 1) Scope & intent

**In scope**

* Accessibility and visual polish for the **Pets list**, **detail view**, and **banner slot**.
* Re-writing empty/error copy to plain, human-readable phrasing.
* Focus outlines, ARIA landmarks, and keyboard tab order.
* Theme-aware banner artwork for both light and dark modes.

**Out of scope**

* Structural UI rewrites or feature additions (no new buttons, tabs, or CRUD logic).
* Accessibility audits of unrelated domains (Family, Bills, Vehicles).

---

## 2) Deliverables

| Deliverable                       | Description                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------- |
| **AA Contrast Compliance**        | All text and icon colours meet WCAG 2.1 AA contrast (≥ 4.5:1 normal, 3:1 large). |
| **Focus & Keyboard Navigation**   | Visible focus rings on all interactive elements, proper tab order.               |
| **ARIA Landmarks & Live Regions** | `role="main"`, `role="region"`, and `aria-live` attributes on dynamic lists.     |
| **Copy Polish**                   | Friendly language for empty/error states and toast notifications.                |
| **Banner Assets**                 | Single vertical banner with CSS tint adjustments for light/dark parity.          |
| **Theme Sync**                    | Instant swap on theme change; no resize flicker.                                 |
| **Accessibility Tests**           | Keyboard-only traversal and screen-reader confirmation of region announcements.  |
| **Documentation**                 | Updates to `docs/pets/ui.md` and `docs/pets/architecture.md`.                    |

---

## 3) Detailed tasks

### 3.1 Contrast audit

Run automated audit (e.g., Axe DevTools or Lighthouse) on `/pets` in both themes.
Adjust SCSS tokens as needed:

* Text on accent backgrounds → use `--color-text-on-accent`.
* Secondary metadata (dates, types) → darken from 500→600 tier in theme palette.
* Disabled states → raise from 300→400 tier to meet ≥ 3:1 contrast.

### 3.2 Focus handling

Enhance global `focus-ring.scss`:

```scss
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: var(--radius-base);
}
```

Apply `tabindex="0"` where missing (banner container, list UL wrapper).
Ensure Escape, Cmd/Ctrl + Enter shortcuts (from PR7) remain functional.

### 3.3 ARIA landmarks

Assign:

* `role="main"` to the section container.
* Each pet card → `role="region"`, `aria-label="Pet: <name>"`.
* List updates (add/delete) → fire `aria-live="polite"` updates.

Example markup:

```html
<section role="main" aria-label="Pets list" aria-live="polite">
  <ul>
    <li role="region" aria-label="Pet: Whiskey the Husky">…</li>
  </ul>
</section>
```

### 3.4 Empty/error copy

Replace silent blank states with friendly text:

| Context               | Message                                                           |
| --------------------- | ----------------------------------------------------------------- |
| **Empty list**        | “You haven’t added any pets yet. Click ‘Add Pet’ to get started.” |
| **Network error**     | “Couldn’t fetch pets. Check your connection and try again.”       |
| **Medical empty**     | “No medical history yet — add your first record below.”           |
| **Broken attachment** | “This document can’t be found. Use ‘Fix path’ to relink it.”      |

All messages pass through localisation for future i18n.

### 3.5 Banners (vertical right-edge)

Implement banner slot introduced in PR4:

```ts
updatePageBanner('pets', currentTheme);
```

Assets:

* `src/assets/banners/pets/pets.png`

Behaviour:

* Centered vertically, full-height stretch with `object-fit: cover`.
* `opacity` transition (200 ms) on theme toggle, **no reflow**.
* `prefers-reduced-motion` → disables animation.

CSS:

```scss
.banner--pets {
  grid-column: right-edge;
  width: 120px;
  background: var(--banner-pets) center/cover no-repeat;
  transition: opacity 0.2s ease, filter 0.2s ease;
}
.banner--pets[data-banner-theme="dark"] {
  filter: brightness(0.72) saturate(0.92) contrast(1.05);
}
@media (prefers-reduced-motion: reduce) {
  .banner--pets {
    transition-duration: 0s;
  }
}
```

### 3.6 Copy polish for toasts

Update toast text in `presentFsError` and medical CRUD paths:

* “Pet added successfully.”
* “Medical record saved.”
* “Attachment fixed.”
* “Deletion cancelled.”

Ensure all toasts specify `aria-live="assertive"` for immediate screen-reader feedback.

### 3.7 Screen-reader checks

Verify with VoiceOver (macOS):

* Adding a pet announces “Pet added: <name>”.
* Switching theme triggers no new announcement (decorative banner).
* Navigating into medical tab announces section title.
* Focus returns to Add Pet button after closing detail view.

---

## 4) Tests

| Test                 | Method                                   | Pass criteria                       |
| -------------------- | ---------------------------------------- | ----------------------------------- |
| **Contrast**         | Lighthouse ≥ 90 score / manual AA ratios | All text ≥ 4.5:1 (3:1 large)        |
| **Keyboard nav**     | Tab through all controls                 | No traps, visible focus always      |
| **Screen reader**    | VoiceOver, NVDA                          | Announces list changes and toasts   |
| **Banner swap**      | Toggle theme                             | No layout shift, correct asset      |
| **Reduced motion**   | prefers-reduced-motion                   | Animation disabled gracefully       |
| **Empty/error copy** | Force no-data / error                    | Friendly message shown, no raw HTML |

---

## 5) Acceptance checklist

| Condition                              | Status | Evidence                    |
| -------------------------------------- | ------ | --------------------------- |
| WCAG AA contrast verified              | ☐      | Screenshot or audit log     |
| Focus ring visible everywhere          | ☐      | Manual traversal            |
| ARIA regions announce correctly        | ☐      | Screen-reader transcript    |
| Empty/error copy present               | ☐      | UI screenshots              |
| Banner swaps instantly on theme toggle | ☐      | Recording or inspector diff |
| No layout shift on banner load         | ☐      | Chrome Performance trace    |
| Docs updated                           | ☐      | Commit diff                 |
| macOS CI passes a11y tests             | ☐      | Workflow log                |

---

## 6) Documentation updates required

| File                          | Update                                                             |
| ----------------------------- | ------------------------------------------------------------------ |
| `docs/pets/ui.md`             | Add Accessibility & Banner subsections with ARIA and colour notes. |
| `docs/pets/architecture.md`   | Reference banner slot and a11y guarantees.                         |
| `docs/pets/plan/checklist.md` | Add PR9 verification items.                                        |
| `docs/pets/references.md`     | Link to Accessibility guidelines and theme tokens.                 |

---

## 7) Verification workflow

1. Run `npm run tauri dev`, open `/pets`.
2. Tab through list and form controls. Confirm visible focus ring.
3. With VoiceOver enabled, add a pet → confirm announcement.
4. Delete a pet → confirm “Pet deleted” toast announced.
5. Toggle dark/light theme → watch banner swap with no layout jump.
6. Run Lighthouse audit → Accessibility score ≥ 95.
7. Export diagnostics → confirm no ARIA/log regressions.

---

## 8) Risks & mitigations

| Risk                               | Mitigation                                                  |
| ---------------------------------- | ----------------------------------------------------------- |
| Banner causes layout shift         | Reserve fixed width (120 px) and load both variants hidden. |
| Low-contrast states missed         | Include automated contrast lint in build (guard:ui-colors). |
| Screen reader double announcements | Ensure only one `aria-live` region active per view.         |
| Focus lost after detail close      | Restore focus explicitly via `focusLastButton()` helper.    |

---

## 9) Sign-off

| Role          | Name              | Responsibility                                     |
| ------------- | ----------------- | -------------------------------------------------- |
| **Developer** | Ged McSneggle     | Implement A11y features, banner sync, copy updates |
| **Reviewer**  | Paula Livingstone | Validate tone, contrast, and banner behaviour      |
| **CI**        | Automated         | Run Lighthouse + a11y workflows on macOS           |

---

**Status:** Ready for implementation
**File:** `/docs/pets/plan/pr9.md`
**Version:** 1.0
**Scope:** Final polish phase bringing Pets to accessibility, contrast, and theme parity across the Arklowdun app.
