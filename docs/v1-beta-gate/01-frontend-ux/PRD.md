# PR-D — Cross-Feature Import Cleanup

## Purpose
Eliminate **cross-feature reach-throughs** where one feature imports another feature’s internals.  
All genuinely shared utilities should be centralised in `@lib`, and each feature must expose only its **own barrel** (`@features/<name>`).  
This ensures boundaries remain clean and future refactors are safe.

---

## Scope

**In:**
- Identify all imports where a feature pulls code directly from another feature’s `components/`, `api/`, `model/`, or `hooks`.
- Relocate truly shared code into `src/lib/` with a narrow public API.
- Redirect affected imports to `@lib/*` or to the feature’s own barrel if it was just bypassing it.
- Update barrels as needed so they export the minimal intended public surface.

**Out:**
- No new features or functionality.
- No styling or UI changes.
- No behavioural changes in existing features.

---

## Deliverables

1. **Inventory of cross-feature imports**
   - Repo-wide scan for `@features/*/components`, `@features/*/api`, `@features/*/model`, `@features/*/hooks` usage outside their own feature.
   - List each occurrence in the PR body with file + line + import path.

2. **Classification**
   - Decide for each occurrence whether the import is:
     - a) a **true cross-feature leak** → must move to `@lib`.  
     - b) a **barrel bypass** → must switch to `@features/<name>`.  
     - c) a **false positive** (internal-to-feature).  

3. **Relocation to `@lib`**
   - For true cross-feature utilities, create a module in `src/lib/` with a narrow API (one file per concern).
   - Update barrels and consumers to import only from `@lib/*`.

4. **Import rewiring**
   - Replace all leaks with imports from either the appropriate feature barrel or `@lib`.
   - Remove any leftover deep imports in app code.

5. **Documentation**
   - In the PR body:  
     - Table of moved utilities (old path → new path).  
     - Table of updated imports (before → after).  
     - Repo scan output confirming no cross-feature internals remain.

---

## Acceptance Criteria

- [ ] No file in `features/*` imports another feature’s `components/`, `api/`, `model/`, or `hooks`.  
- [ ] All cross-cutting code lives in `src/lib/` with small, documented public APIs.  
- [ ] All feature consumers import from their feature barrel only (`@features/<name>`).  
- [ ] App builds and runs identically (ZVD).  
- [ ] PR body contains:  
  - Import inventory.  
  - Classification table.  
  - Relocation + rewiring tables.  
  - Scan output proving compliance.

---

## Evidence Ged must attach

- **Cross-feature import inventory (sample):**

  | File                    | Line | Old Import Path                            | Classification |
  |-------------------------|------|--------------------------------------------|----------------|
  | `CalendarView.ts`       | 12   | `@features/notes/model/Note`              | Leak → @lib    |
  | `NotesToolbar.tsx`      | 9    | `@features/calendar/hooks/useCalendar`    | Leak → @lib    |
  | `SettingsView.ts`       | 21   | `@features/files/api/filesApi`            | Barrel bypass  |

- **Relocation table (sample):**

  | Old Path                                | New Path            | Notes                    |
  |-----------------------------------------|---------------------|--------------------------|
  | `features/notes/model/Note.ts`          | `lib/models/Note.ts`| Shared across features   |
  | `features/calendar/hooks/useCalendar.ts`| `lib/hooks/useCalendar.ts` | Shared read util |

- **Rewiring table (sample):**

  | File              | Old Import                          | New Import           |
  |-------------------|-------------------------------------|----------------------|
  | `SettingsView.ts` | `@features/files/api/filesApi`      | `@features/files`    |
  | `CalendarView.ts` | `@features/notes/model/Note`        | `@lib/models/Note`   |

- **Search results:** proof of zero remaining cross-feature deep imports.

---

## Risks & Mitigations

- **Risk:** `@lib` becomes a dumping ground.  
  *Mitigation:* enforce narrow modules and document the purpose of each new `@lib` file in the PR body.  

- **Risk:** accidental behaviour changes during relocation.  
  *Mitigation:* relocate only; do not refactor logic.  

- **Risk:** hidden leaks remain.  
  *Mitigation:* repo-wide scan and reviewer verification.  

---

## Rollback Plan

- Revert relocated utilities to their original feature folders.  
- Revert consumer imports to original deep paths.  
- Restore app to pre-PR import graph.

---

## PR Checklist (to include in PR body)

- [ ] Repo-wide inventory of cross-feature imports produced.  
- [ ] Each occurrence classified (leak, bypass, false positive).  
- [ ] True leaks moved to `@lib` with small APIs.  
- [ ] Barrel bypasses redirected to feature barrels.  
- [ ] Repo scan confirms no cross-feature internals remain.  
- [ ] ZVD confirmed (no visual/behavioural changes).  
- [ ] Relocation + rewiring tables attached.  
- [ ] Rollback plan described.  
