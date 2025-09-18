# PR-B — Define Feature Barrels & Switch Imports

## Purpose
Establish explicit **public surfaces** per feature so consumers only import via the barrel (`index.ts`) and never reach into internals.  
This gives each feature a stable API, enforces boundaries, and prevents uncontrolled coupling between slices.

---

## Scope

**In:**
- Populate `features/*/index.ts` with the minimal set of exports each view legitimately consumes.
- Update existing imports in app code to use the feature barrel (`@features/<name>`) instead of deep paths.

**Out:**
- No new components, hooks, or business logic.
- No styling changes.
- No feature migrations beyond import redirection.

---

## Deliverables

1. **Public surface definition**
   - For each feature (`files`, `calendar`, `notes`, `settings`), define what belongs in its public API:  
     - Core components consumed by views (e.g., `FilesList`, `CalendarGrid`).  
     - Hooks/views used by routing or other top-level logic.  
     - Typed models that must be shared outside the feature.  
   - Export only these items from `index.ts`.  
   - Do **not** re-export everything (avoid “god barrel”).

2. **Import redirection**
   - Replace all deep imports (`@features/files/components/FilesList`) with barrel imports (`@features/files`).  
   - Ensure no app-level file reaches into `components/`, `api/`, `model/`, or `hooks` directly.

3. **Documentation**
   - In the PR body, include a per-feature export list and an import mapping table (before → after).

---

## Acceptance Criteria

- [ ] Each feature has a non-empty `index.ts` defining its public surface.  
- [ ] No `@features/*/components`, `@features/*/api`, `@features/*/model`, or `@features/*/hooks` imports exist outside the feature’s own folder.  
- [ ] All consumers import only from `@features/<name>`.  
- [ ] App builds and runs identically (ZVD).  
- [ ] PR body contains:  
  - Per-feature export list.  
  - Mapping table of old deep imports → new barrel imports.  
  - Repo scan results confirming compliance.

---

## Evidence Ged must attach

- **Export lists:** e.g.,  
  ```text
  features/files/index.ts exports: FilesList, FilesToolbar, useFiles, FileItem
  features/calendar/index.ts exports: CalendarGrid, useCalendar, CalendarEvent
  features/notes/index.ts exports: NotesList, useNotes, Note
  features/settings/index.ts exports: SettingsPanel, useSettings
