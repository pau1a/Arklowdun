# PR-F — Zero-Visual-Delta (ZVD) Evidence Pack

## Purpose
Prove that the frontend fixup work (PR-A/B/C/D/E predecessors) produced **no visual or behavioural changes**.  
This PR contains **evidence only** (screens, DOM dumps, size tables, short notes) and **no code changes**.

---

## Scope

**In:**
- Capture before/after artefacts for the four primary panes (Files, Calendar, Notes, Settings).
- Record DOM structure and CSS bundle sizes.
- Provide a short behavioural sanity note for two flows (boot + import modal open).

**Out:**
- Any code modifications, styling changes, or build pipeline edits.
- New tests or tooling; use existing repo/build outputs.

---

## Environment & Setup (must be fixed for both BEFORE and AFTER)
- **Machine:** same hardware and OS user account.
- **Window:** same size in logical pixels (record exact width × height).
- **Zoom/Scale:** browser/tauri zoom 100%, same display scale factor.
- **Theme:** same theme (light/dark) and font settings.
- **Data state:** use the same local database and attachments; no edits between captures.
- **Version tags:** note commit SHAs for BEFORE and AFTER at the top of the PR body.

---

## Deliverables

1) **Screenshots (visual parity)**
   - For each pane (Files, Calendar, Notes, Settings), capture:
     - **Default view** after app load.
     - **Empty state** (if easily reproducible) or a representative list view.
     - **Error toast/dialog** (trigger any safe, existing error—do not modify code).
   - Provide **paired** BEFORE/AFTER images per case.
   - File naming: `files-default-before.png`, `files-default-after.png`, etc.

2) **DOM subtree dumps (structural parity)**
   - For each pane: copy/paste the **outerHTML** of its root container element (or an equivalent DOM tree snippet) for both BEFORE and AFTER.
   - Keep only the relevant subtree (pane content wrapper) to avoid noise.
   - Place each pair in collapsible sections in the PR body.

3) **CSS asset size table (bundle parity)**
   - Record the CSS asset file names and sizes from the build output (or dev server if that’s your only mode).
   - Provide BEFORE/AFTER sizes in a small table.
   - Acceptable variance: **±1–2%** (explain any larger deltas).

4) **Behavioural sanity notes (no change)**
   - **Boot sequence:** confirm the app reaches the same initial pane and shows the same toolbar/sidebar elements.
   - **Import modal open:** confirm it opens, logs start/progress/done, and the “open log” button appears when expected.
   - Two short bullet lists (BEFORE vs AFTER) suffice.

5) **Console & network noise check (optional but helpful)**
   - Note any new console errors/warnings or unexpected network/IPC chatter during the captures.
   - State “no change” or list differences (should be none).

---

## Acceptance Criteria

- [ ] Screenshots: reviewers can visually confirm **no differences** across all captured panes/states.
- [ ] DOM dumps: structural parity (no added/removed elements of significance; attribute differences explained if present).
- [ ] CSS sizes: within ±1–2% or a brief rationale provided.
- [ ] Behavioural notes: boot and import-modal flows unchanged.
- [ ] No code changes included in this PR.

---

## Evidence Ged must attach (structure of the PR body)

### Header
- **BEFORE SHA:** `abc123…`
- **AFTER SHA:** `def456…`
- **Env:** macOS version, window size (e.g., 1280×900 logical), theme, scale factor, dataset tag.

### Visual Parity
- **Files — default**  
  BEFORE: _image_ • AFTER: _image_  
- **Files — error/empty**  
  BEFORE: _image_ • AFTER: _image_  
- **Calendar — default**  
  BEFORE: _image_ • AFTER: _image_  
- **Calendar — error/empty**  
  BEFORE: _image_ • AFTER: _image_  
- **Notes — default**  
  BEFORE: _image_ • AFTER: _image_  
- **Settings — default**  
  BEFORE: _image_ • AFTER: _image_

### DOM Parity
<details><summary>Files DOM (before)</summary>

```html
<!-- outerHTML of Files pane root -->
<!-- … -->
````

</details>

<details><summary>Files DOM (after)</summary>

```html
<!-- outerHTML of Files pane root -->
<!-- … -->
```

</details>

*(Repeat DOM before/after for Calendar, Notes, Settings.)*

### CSS Size Table

| Asset        | BEFORE (KB) | AFTER (KB) | Δ    |
| ------------ | ----------- | ---------- | ---- |
| `styles.css` | 123.4       | 123.2      | -0.2 |
| `vendor.css` | 45.1        | 45.1       | 0.0  |

> Note: Any Δ > 2% must have an explanation.

### Behavioural Sanity Notes

* **Boot:**
  BEFORE → lands on Files, sidebar shows X items, toolbar shows Y buttons.
  AFTER → same.

* **Import Modal:**
  BEFORE → opens from Files toolbar; logs started/progress/done; “open log” appears.
  AFTER → same.

### Console / Network Notes (optional)

* BEFORE: no warnings, 0 network calls.
* AFTER: identical.

---

## Risks & Mitigations

* **Risk:** Environmental drift (window size/scale) causes false diffs.
  *Mitigation:* Fix window size & scale and record them in the header; re-capture if inconsistent.\*

* **Risk:** Data changed between captures.
  *Mitigation:* Use a snapshot of the same local DB; avoid edits during capture.\*

* **Risk:** Overly large DOM dumps.
  *Mitigation:* Limit to pane root subtree and elide dynamic IDs if needed.\*

---

## Rollback Plan

* None required; evidence-only PR. If a difference is detected, address it in a follow-up code PR and re-run this evidence capture.

---

## PR Checklist (to include in PR body)

* [ ] BEFORE/AFTER SHAs and environment recorded.
* [ ] Paired screenshots for Files/Calendar/Notes/Settings (default + one variant).
* [ ] DOM dumps (before/after) for each pane’s root container.
* [ ] CSS size table with deltas and any explanations.
* [ ] Behavioural sanity notes (boot + import modal).
* [ ] No code changes in this PR.
