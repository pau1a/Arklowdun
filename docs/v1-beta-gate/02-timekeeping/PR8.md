# PR-8 Mandate — Expansion Limits & Truncation Signals

## Objective
Enforce safe limits on recurrence expansion and provide **clear truncation signals** to downstream consumers (IPC, UI).  
Guarantee that over-expansion does not degrade performance and that users are explicitly informed when results are cut short.

---

## Scope
- Implement hard caps on recurrence expansion:
  - **Per-series cap:** maximum 500 instances generated from a single RRULE.
  - **Per-query cap:** maximum 10,000 instances returned by `events_list_range`.
- Add truncation signalling:
  - IPC responses must include a `truncated: true` flag when limits are hit.
  - UI must display a banner/badge with copy: *“This list was shortened to the first N results.”*
- Ensure deterministic ordering: even when truncated, returned instances must follow consistent ordering rules (UTC start, title, ID).
- Document the truncation policy in `/docs/recurrence-limits.md`.

---

## Non-Goals
- No changes to the recurrence matrix itself (covered in PR-7).  
- No UX design iteration beyond minimal, copy-ready banner.  
- No adjustments to EXDATE/RDATE handling (separate PRs).  

---

## Acceptance Criteria
1. **Cap Enforcement:** Engine stops expansion after 500 instances per series and 10,000 per query.  
2. **Deterministic Output:** Results always sorted consistently; truncation does not alter order of returned items.  
3. **IPC Response:** When truncation occurs, `truncated: true` appears in payload; `false` otherwise.  
4. **UI Signal:** Banner appears only when `truncated: true`; accessible via aria-live and keyboard focusable close button.  
5. **Test Coverage:** Unit and integration tests for:
   - Series > 500 → truncated.
   - Query > 10,000 → truncated.
   - Below limits → not truncated.  
6. **CI Integration:** New tests run as part of `gate/rrule-matrix`; failure on incorrect signalling.  
7. **Documentation:** `/docs/recurrence-limits.md` explains limits, rationale, and UI expectations.

---

## Evidence Required in PR
- **Failing Demo:** Test log showing 600-instance series → 500 returned, `truncated: true`.  
- **Passing Demo:** Test log showing 20-instance series → 20 returned, `truncated: false`.  
- **UI Screenshot:** Banner shown in UI when truncation occurs, absent when not.  
- **IPC Payload Example:** JSON snippet with `truncated: true`.  
- **Doc Proof:** Added `/docs/recurrence-limits.md` with copy text.

---

## Rollback Plan
- Remove truncation checks and IPC/UI signalling.  
- Delete `recurrence-limits.md` documentation.  
- Restore pre-existing behaviour (unbounded expansion).  
- Rollback is safe but would regress performance protection.

---

## PR Title / Description
- **Title:** `feat(recurrence): enforce expansion limits and surface truncation signals`  
- **Body:** Must include Objective, Scope, Non-Goals, Acceptance Criteria, Evidence, and Rollback.

---
```
