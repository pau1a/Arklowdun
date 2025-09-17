# Frontend UX

## Goal
One paragraph that states the intent in user terms.

## Exit criteria
- Clear, testable conditions (no hand-waving).
- State files/tests that prove it (link to `tests.manifest.md` entries).

## Scope (in)
- Bullet list of included tasks.

## Scope (out)
- Bullet list of explicitly deferred items.

## Owners
- Primary: @ged
- Reviewer: @paula (gatekeeper)


Sweet. Here’s a **10-step, repo-ready plan** to land “Section 1: Frontend Structure & UX Coherence” without boiling the ocean or switching frameworks mid-stride. Each step has: goal → changes → acceptance.

---

### 1) Create the feature-slice skeleton and import aliases

**Goal:** Move from flat views to a clean, enforceable structure.

**Changes**

* Add folders:

  ```
  /src/features/{files,calendar,notes,settings}/
    components/
    api/
    model/
    hooks/
    index.ts
  /src/ui/          // primitives (button, input, modal, toast, empty/error/loading)
  /src/layout/      // Page, Sidebar, Toolbar, Content
  /src/lib/         // keep: ipc, event-bus, logger
  /src/store/       // tiny app store (see step 3)
  ```
* `tsconfig.json` paths:

  ```json
  "baseUrl": "src",
  "paths": {
    "@features/*": ["features/*"],
    "@ui/*": ["ui/*"],
    "@layout/*": ["layout/*"],
    "@lib/*": ["lib/*"],
    "@store/*": ["store/*"]
  }
  ```

**Acceptance**

* `tree -L 3 src` shows the above.
* All imports in new code use `@features/*`, `@ui/*`, etc. (no `../../..`).

---

### 2) Introduce architectural lint rules + guardrails

**Goal:** Stop IPC and deep-relative imports leaking into views.

**Changes**

* Add ESLint + plugins (`import`, `unused-imports`, `eslint-plugin-security`, `eslint-plugin-jsx-a11y` is fine even for DOM).
* `.eslintrc.cjs` (key bits):

  ```js
  rules: {
    "no-restricted-imports": [
      "error",
      { "patterns": ["../*", "../../*"] }
    ],
    "import/no-restricted-paths": ["error", {
      "zones": [
        { "target": "./src/features", "from": "./src/lib/ipc" } // only via adapters
      ]
    }]
  }
  ```
* Keep existing `scripts/guards/no-direct-invoke.sh`; add ESLint to CI.

**Acceptance**

* CI fails on any direct `invoke()` outside `src/lib/ipc` or deep relative imports in features.

---

### 3) Add a tiny global store + event bus

**Goal:** Remove ad-hoc state; standardise data flow.

**Changes**

* `/src/store/index.ts`: minimal state pattern (Zustand-style or a tiny custom pub/sub) with selectors for `activePane`, `errors`, and per-feature caches (files/events/notes).
* `/src/shared/eventBus` → fold into `/src/store/events.ts` with typed channels.

**Acceptance**

* `FilesView`, `CalendarView`, `NotesView` no longer own global arrays; they read/write via store.
* One unit test proves a write emits a store event and re-renders consumer.

---

### 4) Build **UI primitives** and replace raw DOM in one pane (Files) first

**Goal:** Establish the contract for everything else.

**Changes**

* Create `/src/ui/` primitives:

  * `Button.ts` (variants: primary/ghost/danger, sizes: sm/md, disabled, aria-pressed)
  * `Input.ts`, `Select.ts`, `Checkbox.ts`, `Switch.ts`
  * `Modal.ts` (focus trap + restore), `Tooltip.ts`, `Toast.ts`
  * `EmptyState.ts`, `ErrorBanner.ts`, `Loading.ts` (skeleton block too)
* Refactor `/src/features/files/components/FilesList.ts` to use primitives.
* Move `createEmptyState` logic into `@ui/EmptyState`.

**Acceptance**

* Files pane renders with primitives only (no raw `<button>`/`<input>` in feature files).
* Keyboard + ARIA behaviours pass a11y smoke test (see step 7).

---

### 5) Introduce layout primitives and hash-router cleanup

**Goal:** Coherent page chrome, predictable navigation.

**Changes**

* `/src/layout/{Page,Sidebar,Content,Toolbar,Footer}.ts`.
* Replace manual DOM stitching in `main.ts` with:

  * `renderApp({ route })` using `Page` + slotting `Sidebar` and route content.
  * Centralise route table: `routes.ts` maps `#/files|#/calendar|#/notes|#/settings` → feature bootstraps.

**Acceptance**

* Switching panes doesn’t rebuild the world; layout stays stable.
* Sidebar active state controlled by route table, not scattered code.

---

### 6) Design tokens → tokens-to-class pipeline

**Goal:** Single source of truth for spacing, colour, radius, typography.

**Changes**

* Keep `src/theme.scss` as tokens; export a small TS map for JS usage:

  * `src/ui/theme.ts` reads CSS custom properties at runtime and exposes `getToken('--space-2')`, etc.
* Button/Input/Modal consume size/colour tokens; **no hard-coded hex** in components.

**Acceptance**

* Grep shows no literal colours in `src/ui/*`.
* Dark mode automatically switches via existing `prefers-color-scheme` overrides.

---

### 7) Accessibility + keyboard standards (global)

**Goal:** Baseline a11y that’s testable.

**Changes**

* `/docs/a11y-checklist.md` (roles, headings, focus order, skip link, contrast, reduced-motion).
* Add `axe-core` smoke check with Playwright on two screens (Files and Calendar) to catch obvious violations.
* Create `/src/ui/keys.ts` keyboard map:

  * `Cmd/Ctrl+K` open palette
  * `Esc` close modal/palette
  * `[`/`]` switch panes (example) — or document if deferred.

**Acceptance**

* `pnpm test:a11y` (or `npm`) runs and passes axe checks for Files + Calendar.
* Modals: tab trap, `aria-modal`, focus restore tested.

---

### 8) Loading, empty, error patterns (canonical triad)

**Goal:** Eliminate bespoke banners and spinners.

**Changes**

* `@ui/Loading` (skeleton + label), `@ui/EmptyState` (icon/title/body/cta), `@ui/ErrorBanner` (inline, dismissible).
* Replace `#errors` banner usage in Files with `ErrorBanner` and `Toast`.
* Document usage in `/docs/ui-patterns.md`.

**Acceptance**

* Files pane shows the triad: loading skeleton → list/empty → inline error or toast.
* One Playwright spec validates state transitions.

---

### 9) Responsiveness and theming polish

**Goal:** Looks sane from 1024px down to \~360px; dark mode not an afterthought.

**Changes**

* Add responsive utilities (`.hide-sm`, `.stack-md`) or Tailwind-like helpers if desired.
* Sidebar collapses under 900px (icon-only), toolbar compacts.
* Optional: simple theme toggle persisted to localStorage (`theme: system|light|dark`) with `data-theme` class.

**Acceptance**

* Manual shrink test: no overflow; sidebar collapses; toolbar compacts.
* Theme toggle switches tokens without visual glitches on Files pane.

---

### 10) Tests, CI wiring, and migration of remaining panes

**Goal:** Lock the gains and replicate.

**Changes**

* Add Playwright + a11y job to CI (`test:e2e`, `test:a11y`).
* Unit tests for 3 primitives (Button, Modal, Input) + store.
* Migrate **Calendar → Notes → Settings** to primitives/layout pattern.
* Add a **PR template** that requires:

  * Which of Section 1 checkboxes the PR advances
  * Before/after screenshot (if UI)
  * Proof links: ESLint clean, axe pass, Playwright spec name

**Acceptance**

* CI green on ESLint + unit + e2e + a11y.
* All four panes use primitives/layout; no raw DOM controls in features.
* Section 1 checkbox in `docs/v1-beta-gate.md` can be ticked with evidence links.

---

## Suggested PR sequence (small, safe slices)

1. **PR#S1-01**: Structure + tsconfig paths + ESLint rules (no UI changes).
2. **PR#S1-02**: Store + event bus + route table (no UI changes).
3. **PR#S1-03**: UI primitives (Button/Input/Modal/Toast/Empty/Error/Loading) + Files pane refactor.
4. **PR#S1-04**: Layout primitives + main routing cleanup.
5. **PR#S1-05**: A11y checklist + axe + keyboard map.
6. **PR#S1-06**: Responsiveness + theme toggle.
7. **PR#S1-07**: Calendar refactor → primitives/layout.
8. **PR#S1-08**: Notes refactor → primitives/layout.
9. **PR#S1-09**: Settings refactor → primitives/layout.
10. **PR#S1-10**: Playwright specs for Files/Calendar + PR template + docs/ui-patterns.

This sequence turns your current flat DOM code into a tidy, testable UI system with minimal risk and high leverage. Want me to draft the scaffolding commits (file stubs, ESLint config, tsconfig paths, and the initial `Button`/`Modal`/`ErrorBanner` APIs) so Ged can hit the ground running?
