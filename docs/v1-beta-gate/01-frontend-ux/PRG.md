# PR-G — Hygiene Sweep (Cycles, Suppressions, Tickets)

## Purpose
Close out the frontend fixup work with a **hygiene audit**.  
This PR documents remaining structural issues (if any), records lint suppressions and TODOs, runs a cycle-dependency audit, and files tickets for anything unresolved.  
It produces transparency and a clean slate before moving to the next tier of work.

---

## Scope

**In:**
- Run a dependency cycle audit on `src/**`.
- Inventory all `eslint-disable` and `TODO` comments in the codebase.
- Classify each suppression/TODO (keep vs fix later).
- File GitHub issues (or equivalent) for actionable items with owner + priority.
- Attach all reports and links in this PR.

**Out:**
- No code changes to address the items (that’s follow-up work).
- No new features, styling, or runtime refactors.

---

## Deliverables

1. **Cycle-dependency audit**
   - Use a tool (`madge` or similar) to scan `src/**`.
   - Produce a report listing all dependency cycles (if any).
   - Target: **0 cycles**. If not zero, log each with the involved modules.

2. **Suppression & TODO inventory**
   - Grep for `eslint-disable`, `eslint-disable-next-line`, `// TODO`, `// FIXME`.
   - Produce a structured list:
     - File, line, suppression type, and rationale (if documented).
   - Classify each item:  
     - **Acceptable (keep):** justified, e.g. unavoidable pattern.  
     - **Actionable (fix later):** should be removed or replaced.

3. **Tickets**
   - For each actionable item, create a GitHub issue (or repo tracker ticket).
   - Issues must include: description, file/line, acceptance criteria, and priority (P1, P2, P3).
   - Link all issues back in the PR body.

4. **Summary Table**
   - High-level counts: total suppressions, accepted, actionable, tickets raised.

5. **Documentation**
   - Append to `docs/v1-beta-gate.md`: short section on “Hygiene Monitoring” describing the sweep cadence (e.g. repeat quarterly or pre-release).

---

## Acceptance Criteria

- [ ] Cycle audit report attached in PR body, showing 0 cycles or listing each with file paths.  
- [ ] Suppression/TODO inventory attached, structured and complete.  
- [ ] Each actionable item has a linked issue with owner + priority.  
- [ ] Summary table of counts included.  
- [ ] `docs/v1-beta-gate.md` updated with “Hygiene Monitoring” section.  
- [ ] No code changes introduced in this PR.

---

## Evidence Ged must attach

### Cycle Audit
<details><summary>Cycle Report</summary>

```text
# Example format
No dependency cycles detected in src/**
````

*or*

```text
Cycle 1:
  src/features/notes/hooks/useNotes.ts → src/lib/logger.ts → src/features/notes/hooks/useNotes.ts
```

</details>

### Suppressions & TODOs

<details><summary>Suppressions Inventory</summary>

| File                   | Line | Type                                                      | Current Note                         | Classification |
| ---------------------- | ---- | --------------------------------------------------------- | ------------------------------------ | -------------- |
| src/utils/highlight.ts | 77   | // TODO                                                   | “support Unicode case folding”       | Actionable     |
| src/ui/ImportModal.ts  | 101  | eslint-disable-next-line security/detect-object-injection | no rationale                         | Actionable     |
| src/store/index.ts     | 44   | eslint-disable                                            | justification: intentional perf hack | Acceptable     |

</details>

### Tickets

* [ ] Issue #321 — Support Unicode case folding in highlight util (P2).
* [ ] Issue #322 — Remove object-injection eslint disable in ImportModal (P1).

### Summary Table

| Category           | Count |
| ------------------ | ----- |
| Total suppressions | 12    |
| Acceptable         | 7     |
| Actionable         | 5     |
| Issues filed       | 5     |

---

## Risks & Mitigations

* **Risk:** Report grows stale.
  *Mitigation:* repeat sweep before every major release; add “Hygiene Monitoring” cadence to docs.

* **Risk:** Issues filed without owners.
  *Mitigation:* assign explicit owners + priorities before merging this PR.

---

## Rollback Plan

* None required; this PR only adds reports and documentation.

---

## PR Checklist (to include in PR body)

* [ ] Cycle audit report attached.
* [ ] Suppression/TODO inventory attached.
* [ ] All actionable items have tickets with owners/priorities.
* [ ] Summary table included.
* [ ] `docs/v1-beta-gate.md` updated with “Hygiene Monitoring”.
* [ ] No code changes.
