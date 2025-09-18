# PR-A — Eliminate IPC leaks

## Purpose
Remove all direct IPC usage from UI/runtime surfaces so components never talk to IPC directly.

## Scope
- In: relocate IPC call sites from identified leak points into proper adapters.
- Out: behavioural/UI changes; new features; refactors beyond the leak points.

## Changes (high-level)
- Move IPC calls from <files/paths TBD> into feature `api/` or `src/lib/ipc`.
- Update callers to consume adapters only.

## Acceptance Criteria
- [ ] Repo-wide search shows **zero** IPC imports under `src/ui/**`, `src/**/components/**`, `src/main.ts`.
- [ ] App builds and behaviours unchanged (ZVD).

## Evidence to Attach
- Leak points list (before → after).
- Short diff summary per moved call site.
- Grep/scan output proving zero IPC in forbidden paths.

## Risks & Mitigations
- Risk: hidden side-effects during move → Mitigation: move-only, no signature changes.

## Rollback Plan
- Revert the adapter moves (list files); restore original call sites.

---


# PR-B — Define feature barrels & switch imports

## Purpose
Establish explicit public surfaces per feature and ensure consumers import barrel-only.

## Scope
- In: populate `features/*/index.ts` with minimal public exports; switch app imports to barrel paths.
- Out: moving internal logic between features; creating new components.

## Changes (high-level)
- Define public exports per feature (types/components/hooks).
- Replace deep feature imports with `@features/<name>`.

## Acceptance Criteria
- [ ] No `@features/*/components` (or deeper) imports outside feature boundaries.
- [ ] App compiles; behaviour unchanged (ZVD).

## Evidence to Attach
- Per-feature export list in the PR body.
- Grep/scan showing only barrel imports are used.
- Small import diff samples (before/after).

## Risks & Mitigations
- Risk: accidental broad re-export (“god barrel”) → Mitigation: enumerate exports explicitly.

## Rollback Plan
- Revert import updates; restore previous paths.

---


# PR-C — Populate Calendar/Notes/Settings skeletons (minimal adapters)

## Purpose
Make each feature slice real (one adapter + one hook) without changing visuals.

## Scope
- In: add a thin API adapter and a read-only hook for Calendar, Notes, Settings; point views at barrels.
- Out: UI restyle, routing changes, business logic rewrites.

## Changes (high-level)
- Add `api/` adapter + `hooks/` reader per feature.
- Update views to import via the feature barrel.

## Acceptance Criteria
- [ ] Each feature view depends only on its `@features/<name>` barrel.
- [ ] No JSX/CSS changes; behaviour unchanged (ZVD).

## Evidence to Attach
- Import maps (before/after) for the 3 views.
- Short clips/screens (optional) confirming parity.

## Risks & Mitigations
- Risk: hidden side-effect by import order → Mitigation: preserve module init order; no side-effect imports.

## Rollback Plan
- Point views back to previous imports; remove minimal adapters.

---


# PR-D — Cross-feature import cleanup

## Purpose
Stop features from reaching into other features’ internals; centralise truly shared code under `@lib`.

## Scope
- In: relocate cross-cutting utilities to `src/lib/`; update imports accordingly.
- Out: altering utility behaviour; UI changes.

## Changes (high-level)
- Identify cross-feature imports; move to `@lib/*` with a small API.
- Replace reach-through imports in features.

## Acceptance Criteria
- [ ] No feature imports another feature’s internals.
- [ ] Shared utils live under `@lib/*` with narrow interfaces.

## Evidence to Attach
- List of moved utilities (from → to).
- Grep/scan proving no cross-feature internals are imported.

## Risks & Mitigations
- Risk: widen `@lib` surface too much → Mitigation: document each new `@lib` module purpose.

## Rollback Plan
- Restore utilities to prior locations; revert import changes.

---


# PR-E — CI enforcement for structure & IPC boundaries

## Purpose
Make the rules executable: CI blocks IPC-in-components and deep parent-relative imports; reports cross-feature violations.

## Scope
- In: add CI jobs and lint rules; wire as required checks on PRs.
- Out: additional code refactors beyond wiring CI.

## Changes (high-level)
- CI step for IPC-in-components (fail).
- CI step for deep parent-relative imports (fail).
- CI step for cross-feature import report (warn/log counts).

## Acceptance Criteria
- [ ] CI shows the three checks and they pass on this PR.
- [ ] Branch protection marks them as required (fail blocks merge).

## Evidence to Attach
- Link to green CI run showing the new jobs.
- Screenshot/text of branch protection settings (or repo policy note).

## Risks & Mitigations
- Risk: false positives delay merges → Mitigation: start with precise patterns; document escalation path.

## Rollback Plan
- Disable the CI jobs; keep rules documented for later re-enable.

---


# PR-F — Zero-Visual-Delta evidence pack

## Purpose
Prove the structural work didn’t change visuals or behaviour.

## Scope
- In: capture and attach artefacts; no code changes beyond tiny capture hooks if needed.
- Out: UI changes; style tweaks.

## Changes (high-level)
- Capture paired screenshots (Files/Calendar/Notes/Settings).
- Dump DOM subtree for root containers.
- Record CSS asset sizes (before/after).

## Acceptance Criteria
- [ ] Screenshots visually identical (reviewer eyeball).
- [ ] DOM diffs show no structural change.
- [ ] CSS sizes within ±1–2% (explain any anomaly).

## Evidence to Attach
- Images (before/after) with timestamps.
- DOM diff snippets.
- Size table.

## Risks & Mitigations
- Risk: environment differences → Mitigation: capture on same machine/profile.

## Rollback Plan
- Not applicable (evidence only).

---


# PR-G — Hygiene sweep (cycles, suppressions, tickets)

## Purpose
Close structural loose ends and log any remaining work transparently.

## Scope
- In: run a cycle-dependency audit; inventory lint suppressions/TODOs; file follow-up tickets with owners/dates.
- Out: fixing the tickets here (tracked, not solved).

## Changes (high-level)
- Produce a “cycle report” (target: zero).
- Produce a “suppressions register” with justifications.
- Create issues for each actionable item.

## Acceptance Criteria
- [ ] Cycle report attached; zero cycles or remediation issues linked.
- [ ] Suppressions register attached with rationale and expiry or plan.
- [ ] Issues created and linked in the PR body.

## Evidence to Attach
- Reports (text/links).
- Issue links with labels/owners.

## Risks & Mitigations
- Risk: register grows stale → Mitigation: add it to weekly triage.

## Rollback Plan
- Not applicable (documentation and issues only).
