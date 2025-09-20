# V1 Beta Gate

This document defines the **line in the sand** for the Arklowdun app.  
No work outside these five areas may be merged until all criteria are satisfied.  
The app ships to **closed beta testers** only when this gate is complete.

---

## Tier-1 Focus Areas

### 1. Frontend Structure & UX Coherence
- Feature-slice directory structure in `/src/features/{files,calendar,notes,settings}`.  
- Design tokens and primitives (`Button`, `Input`, `Modal`, etc.) replace raw elements.  
- Uniform error/loading/empty states and basic accessibility (roles, focus order, reduced-motion).  
- Lint rules enforce boundaries and forbid direct IPC calls in React components.

**Exit condition:** App layout is coherent, navigable, and all screens use primitives + shared state/store patterns.

---

### 2. Timekeeping Correctness
- `events_backfill_timezone` is chunked, resumable, and benchmarked (10k/100k events).  
- Tests cover DST forward/back, leap day, and cross-TZ wall-clock stability.  
- Recurrence matrix: RRULE fields exercised in automated tests; EXDATE normalised/deduped.  
- UI visibly signals truncation at 500-per-series / 10 000-per-query caps.

**Exit condition:** All timekeeping tests green; UI shows accurate and trustworthy event data.

---

### 3. Data Safety & Recovery
- Startup runs `PRAGMA integrity_check` and WAL sanity checks.  
- Guided repair path: backup → rebuild → restore, with user-facing messages.  
- Export/import round-trip tested with large fixtures to prove data safety.

**Exit condition:** App can detect corruption, repair without loss, and export/import reliably.

---

### 4. Licensing & Compliance
- NOTICE/CREDITS generated automatically from lockfiles in CI and bundled with artifacts.  
- Attribution included for Font Awesome and all other third-party fonts/icons.  
- Copyleft audit performed; compliance steps documented in `/docs/licensing.md`.

**Exit condition:** License obligations are fully met and documented for distribution.

---

### 5. Platform Security & Distribution
- Strict Content Security Policy enforced (no `unsafe-*`, no eval/inline, no remote).  
- Global Tauri APIs disabled where possible; capabilities scoped to main window only.  
- Entitlements and hardened runtime flags defined in `tauri.conf.json5`.  
- Codesign + notarisation pipeline operational with verification script (`spctl`, `stapler`, `codesign`) checked into repo.

**Exit condition:** Staple-verified macOS bundle produced by CI; distribution pipeline reproducible.

---

## Enforcement

- Every PR **must reference** one of the five focus areas.  
- PRs unrelated to this gate are rejected until the gate is complete.  
- Progress is tracked via checkboxes below; beta readiness is declared only when all are ticked.

---

## Checklist

- [x] Frontend structure & UX coherence — Calendar/Notes/Settings now built from UI primitives; ESLint guard prevents raw controls in views.
- [ ] Timekeeping correctness[^rdate-policy]
- [ ] Data safety & recovery
- [ ] Licensing & compliance
- [ ] Platform security & distribution

[^rdate-policy]: `RDATE` support is explicitly deferred until after v1. Refer to [`docs/rdate-policy.md`](./rdate-policy.md) for the full scope rationale and follow-up plan.

---

**When all five boxes are ticked, v1 is declared beta-ready and may be released to closed testers.**
```

Here’s a tight, repo-ready enforcement pack. Drop these files in and turn the gate into hard constraints.

# 1) PR template (forces scope + checklist)

**.github/PULL\_REQUEST\_TEMPLATE.md**

```markdown
## Linked Focus Area
Tick EXACTLY ONE. PRs without a tick are auto-failed by CI.

- [x] Frontend structure & UX coherence
  Evidence: [`ci.yml`](../.github/workflows/ci.yml), [`CalendarView.ts`](../src/CalendarView.ts), [`NotesView.ts`](../src/NotesView.ts), [`SettingsView.ts`](../src/SettingsView.ts), [`panes-primitives.spec.ts`](../tests/ui/panes-primitives.spec.ts)
- [ ] Timekeeping correctness
- [ ] Data safety & recovery
- [ ] Licensing & compliance
- [ ] Platform security & distribution

## Summary
Explain what this PR changes in one paragraph. Include paths and user-visible effects.

## Acceptance
- [ ] Unit/integration tests updated or added
- [ ] Docs updated (if applicable)

Fixes: (optional issue IDs)
```

# 2) Branch protection (GitHub UI)

* Protect `main` and your release branch.
* Require PR, require linear history, dismiss stale reviews, require **status checks**:

  * `gate/pr-focus-check`
  * `gate/lint`
  * `gate/test`
  * `gate/csp-audit` (once you add it)
  * `gate/build`

# 3) CODEOWNERS (route reviews to the right people)

**.github/CODEOWNERS**

```
# App-wide governance
/docs/v1-beta-gate.md        @paulalivingstone

# Focus owners (adjust handles)
src/features/**               @ged-dev
src/**                        @ged-dev @paulalivingstone
docs/**                       @paulalivingstone
```

# 4) Labeler (auto-label PRs by touched paths)

**.github/labeler.yml**

```yaml
frontend-ux:
  - changed-files:
      - any-glob-to-any-file: ["src/**", "!src-tauri/**"]

timekeeping:
  - changed-files:
      - any-glob-to-any-file: ["src-tauri/src/**events**", "src-tauri/tests/**events**", "docs/calendar/**"]

data-safety:
  - changed-files:
      - any-glob-to-any-file: ["src-tauri/src/db/**", "scripts/**migrate**", "docs/db/**"]

licensing:
  - changed-files:
      - any-glob-to-any-file: ["docs/licensing**", "NOTICE*", "LICENSE*", "scripts/**license**"]

platform-security:
  - changed-files:
      - any-glob-to-any-file: ["tauri.conf.*", "src/security/**", "docs/release**", ".github/workflows/**"]
```

# 5) PR focus check (rejects meandering PRs)

**.github/workflows/gate-pr.yml**

```yaml
name: gate/pr-focus-check
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
jobs:
  focus:
    runs-on: ubuntu-latest
    steps:
      - name: Validate PR template tick
        uses: actions-ecosystem/action-regex-match@v2
        id: match
        with:
          text: ${{ github.event.pull_request.body }}
          regex: '^- \[x\] (Frontend structure .*|Timekeeping .*|Data safety .*|Licensing .*|Platform security .*)$'
          flags: 'm'
      - name: Fail if no focus box checked
        if: steps.match.outputs.match == ''
        run: |
          echo "PR MUST tick exactly one Tier-1 focus area in the template." >&2
          exit 1
  labeler:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/labeler@v5
        with:
          repo-token: ${{ secrets.GITHUB_TOKEN }}
```

# 6) Lint + tests + build (status checks)

**.github/workflows/gate-ci.yml**

```yaml
name: gate/ci
on:
  pull_request:
jobs:
  lint:
    name: gate/lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run -s lint
  test:
    name: gate/test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm test --workspaces --if-present
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo test --manifest-path src-tauri/Cargo.toml --all-features --locked
  build:
    name: gate/build
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: dtolnay/rust-toolchain@stable
      - run: npm ci
      - run: npm run -s build:ci
```

# 7) ESLint guardrails (ban direct IPC in components; enforce feature boundaries)

**.eslintrc.cjs** (additions)

```js
module.exports = {
  // ...
  rules: {
    'no-restricted-imports': [
      'error',
      {
        name: '@tauri-apps/api/tauri',
        message: 'Use ipcClient/useIPC in features/*/api only.',
      },
    ],
    'boundaries/element-types': ['error', {
      default: 'disallow',
      rules: [
        { from: ['features/*/components/**'], allow: ['features/*/api/**', 'features/*/store/**'] }
      ]
    }],
    'react-hooks/rules-of-hooks': 'error',
    'jsx-a11y/anchor-is-valid': 'error'
  },
  settings: {
    'import/resolver': { typescript: {} }
  },
  plugins: ['boundaries', 'jsx-a11y']
}
```

# 8) Simple CSP audit (keep it minimal but present)

**scripts/csp-audit.js**

```js
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tauri.conf.json5').toString().replace(/\/\/.*$/gm,'')));
const csp = cfg.security?.csp ?? null;
if (!csp) { console.error('CSP is null. Define a strict CSP.'); process.exit(1); }
if (csp.includes("'unsafe-inline'") || csp.includes("'unsafe-eval'")) {
  console.error('CSP allows unsafe-inline/eval. Tighten policy.');
  process.exit(1);
}
console.log('CSP audit passed.');
```

**package.json** (scripts)

```json
{
  "scripts": {
    "lint": "eslint . --ext .ts,.tsx,.js",
    "test": "vitest run",
    "build:ci": "npm run -s typecheck && npm run -s build:web && npm run -s build:tauri",
    "csp:audit": "node scripts/csp-audit.js"
  }
}
```

**.github/workflows/csp-audit.yml**

```yaml
name: gate/csp-audit
on: pull_request
jobs:
  csp:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run -s csp:audit
```

# 9) PR title convention (optional but useful)

**.github/workflows/commitlint.yml**

```yaml
name: gate/commitlint
on: pull_request
jobs:
  title:
    runs-on: ubuntu-latest
    steps:
      - uses: amannn/action-semantic-pull-request@v5
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          types: |
            feat
            fix
            chore
            docs
            refactor
            test
            perf
```

# 10) PR template enforcement in GitHub UI

* Add a **required** checkbox custom rule in your branch protection (“Require approval by code owners” + required status checks above).
* Optionally create a GitHub App rule with “PR must contain ‘Linked Focus Area’” (the workflow already enforces via regex, but belt + braces).

# 11) Issue templates (keep the backlog aligned)

**.github/ISSUE\_TEMPLATE/focus-task.yml**

```yaml
name: Focus Task
description: Work that advances one Tier-1 area
labels: ["focus"]
body:
  - type: dropdown
    id: area
    attributes:
      label: Focus area
      options:
        - Frontend structure & UX coherence
        - Timekeeping correctness
        - Data safety & recovery
        - Licensing & compliance
        - Platform security & distribution
    validations:
      required: true
  - type: textarea
    id: spec
    attributes:
      label: What & why
      description: Describe acceptance criteria and affected paths.
```

# 12) Pin the constitution

* Commit your `docs/v1-beta-gate.md`.
* Pin it in the repo README and project board.
* Add a required PR checkbox in the template: **“I confirm this PR advances the selected focus area and nothing else.”**

---

This setup makes wandering expensive:

* PRs without a focus tick **fail CI**.
* Direct IPC in components **fails lint**.
* Missing CSP or weak CSP **fails audit**.
* Owners get dragged in automatically.

## Appendix: CI Enforcement (Structure & IPC Boundaries)

To keep these rules tight, CI publishes three dedicated checks whenever a PR opens:

- **`gate/ipc-in-components`** — Fails if files under `src/ui/**`, any `src/**/components/**` folder, or `src/main.ts` import from `@tauri-apps/api*` (or the `@tauri-apps/plugin-*` family). The check prints the exact files and import specifiers so the author can route the IPC call through `src/lib/ipc/**` or a feature API layer instead.
- **`gate/no-deep-relatives`** — Fails when code in `src/**` reaches for paths containing `../..` (or deeper). Current grandfathered offenders are tracked inside the scanner (`scripts/guards/gate-no-deep-relatives.mjs`) and emit `::notice` logs until PR-D retires them. Everyone else must switch to the existing alias set (`@features/*`, `@ui/*`, `@layout/*`, `@lib/*`, `@store/*`).
- **`gate/cross-feature-report`** — Succeeds, but logs a warning summary when feature slices import another feature’s `components/`, `api/`, `model/`, or `hooks/` internals. The output lists each `file → import` pair so the owning team can plan the extraction.

Branch protection on `main` should require the first two checks (`gate/ipc-in-components`, `gate/no-deep-relatives`) before merge. The reach-through report stays informational so it can surface the debt without blocking progress. Locally, `npm run gate:scan` runs all three checks in one go.

Do you want me to also suggest how you enforce this mechanically in GitHub (branch protection / PR template)?
