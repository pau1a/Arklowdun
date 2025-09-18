# PR-E — CI Enforcement for Structure & IPC Boundaries

## Purpose
Make the architectural rules **executable**. CI must block merges when:
1) UI/components (and `main.ts`) import IPC directly, and  
2) deep parent-relative imports appear in app code.  
Additionally, CI should **report** (warn-level) any cross-feature reach-through so we can track and eliminate it.

---

## Scope

**In:**
- Add CI jobs that (a) fail on IPC-in-components and `main.ts`, (b) fail on deep parent-relative imports in `src/**`, and (c) **report** cross-feature internal imports.
- Mark these jobs as **required** checks for PRs (branch protection).
- Add concise documentation of the rules in `docs/v1-beta-gate.md` (appendix) and the PR template.

**Out:**
- No refactors of source code to pass the checks (that’s PR-A/PR-D territory).
- No test or build pipeline redesign.

---

## Deliverables

1) **CI Job: IPC-in-components / main.ts (FAIL)**
   - A CI step that scans the repo and **fails** if any import of Tauri IPC modules is found under:
     - `src/ui/**`
     - `src/**/components/**`
     - `src/main.ts`
   - Document the exact rule in the PR body (paths, patterns).

2) **CI Job: Deep parent-relative imports (FAIL)**
   - A CI step that **fails** when app code in `src/**` includes `../..` (or deeper) imports.
   - Exclusions (if any) must be listed (e.g., tests or external vendor folders).

3) **CI Job: Cross-feature reach-through (WARN/REPORT)**
   - A CI step that **reports** (non-fatal) any imports that reach into another feature’s internals:
     - `@features/<other>/(components|api|model|hooks)/**`
   - Output must be visible in PR checks with a count and a short list (file → import).

4) **Branch Protection**
   - `gate/ipc-in-components` and `gate/no-deep-relatives` set as **required** status checks on the default branch.
   - `gate/cross-feature-report` included as an **informational** check.

5) **Documentation & Governance**
   - Update `docs/v1-beta-gate.md` with a short “CI Enforcement” appendix summarising rules, check names, and failure behavior.
   - Update the PR template to remind authors to run the scans locally before pushing.

---

## Acceptance Criteria

- [ ] CI exposes three distinct checks with clear names:
  - **`gate/ipc-in-components`** — FAIL on any IPC import in forbidden paths.
  - **`gate/no-deep-relatives`** — FAIL on any `../..` imports in `src/**`.
  - **`gate/cross-feature-report`** — WARN with a count + list of cross-feature internal imports.
- [ ] Branch protection lists the two FAIL checks as **required** before merge.
- [ ] A sample failing branch (created during this PR) demonstrates that each FAIL check blocks merge.
- [ ] `docs/v1-beta-gate.md` updated with the rules and check names.
- [ ] PR template includes a reminder to validate locally.

---

## Evidence Ged must attach

- **Screenshot or link** to a passing CI run showing all three jobs and their statuses.
- **Screenshot or link** to a branch protection settings page (or a repo policy doc) listing required checks.
- **Copy/paste** of the CI checks’ human-readable outputs (messages users will see on failure/warn).
- **One intentional fail demo** (temporary branch/or PR closed without merge) showing:
  - IPC import in `src/ui/**` blocked by `gate/ipc-in-components`.
  - Deep relative import blocked by `gate/no-deep-relatives`.
  - Cross-feature reach-through listed by `gate/cross-feature-report` (WARN only).
- **Doc diff** for `docs/v1-beta-gate.md` (appendix added) and PR template note.

---

## Rule Definitions (for documentation; not code)

1) **IPC-in-components / main.ts (FAIL)**
   - Forbidden module families: anything under `@tauri-apps/api/*` (window, event, fs, shell, path, etc.).
   - Forbidden locations:
     - `src/ui/**`
     - `src/**/components/**`
     - `src/main.ts`
   - Allowed: `src/lib/ipc/**` and `src/features/*/api/**`.

2) **No deep parent-relative imports (FAIL)**
   - Forbidden: `(\.\./){2,}` anywhere under `src/**`.
   - Allowed: single-level parent relative imports (`../foo`) within the same feature folder, if not replaceable by alias.
   - Preferred: `@features/*`, `@ui/*`, `@layout/*`, `@lib/*`, `@store/*` aliases.

3) **Cross-feature reach-through (WARN)**
   - Report if a file under `src/features/<A>/**` imports paths under `src/features/<B>/(components|api|model|hooks)/**` where `<A> != <B>`.
   - Preferred fix: move truly shared utilities to `@lib` (PR-D), or import via `<B>`’s barrel.

---

## Risks & Mitigations

- **Risk:** False positives from tools or vendor code.  
  *Mitigation:* scope scans to `src/**`; add explicit excludes for vendor/test scaffolding if needed.

- **Risk:** Excess noise from WARN check discourages adoption.  
  *Mitigation:* keep the WARN list short and actionable; track count deltas over time.

- **Risk:** Checks slow down CI.  
  *Mitigation:* use lightweight scanning; run in parallel with existing lint/test jobs.

---

## Rollback Plan

- Remove the new CI jobs from the workflow file(s).
- Unmark required checks in branch protection.
- Revert doc/template changes.
- Confirm CI returns to prior state.

---

## PR Checklist (to include in PR body)

- [ ] `gate/ipc-in-components` added and blocks IPC imports in forbidden paths.  
- [ ] `gate/no-deep-relatives` added and blocks deep parent-relative imports.  
- [ ] `gate/cross-feature-report` added and lists reach-through imports (WARN).  
- [ ] Branch protection updated to require the two FAIL checks.  
- [ ] One intentional failing demo PR created and linked to show checks working.  
- [ ] `docs/v1-beta-gate.md` updated with “CI Enforcement” appendix.  
- [ ] PR template updated with a “run scans locally” reminder.  
- [ ] Screenshots/links for CI runs and branch protection included.  

---

## Local Pre-Flight (author guidance; optional but helpful)
- Run your local scan equivalents for:
  - Forbidden IPC imports in `src/ui/**`, `src/**/components/**`, `src/main.ts`.
  - Parent-relative depth ≥ 2 under `src/**`.
  - Cross-feature internal imports.
- Fix or ticket anything that appears before opening the PR.
```
