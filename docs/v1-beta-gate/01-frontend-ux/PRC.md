# PR-C — Populate Calendar/Notes/Settings Skeletons (Minimal Adapters)

## Purpose
Bring Calendar, Notes, and Settings feature slices to life by giving each a **real public surface**:  
a thin API adapter, a typed model, and a basic hook.  
This ensures these slices are not empty shells and that their views import exclusively via the feature barrel.

---

## Scope

**In:**
- Create one minimal API adapter per feature in `features/<name>/api`.
- Create one minimal typed model per feature in `features/<name>/model`.
- Create one hook per feature in `features/<name>/hooks` that proxies current read-only behaviour.
- Update feature barrels to export these.
- Redirect each view (CalendarView, NotesView, SettingsView) to import only from its feature barrel.

**Out:**
- No visual or styling changes.
- No new business logic; adapters are pass-throughs to existing IPC or stubbed logic.
- No refactor of unrelated features.

---

## Deliverables

1. **API adapters**  
   - Calendar: a thin wrapper for event fetch (whatever IPC/utility it already uses).  
   - Notes: a thin wrapper for notes fetch.  
   - Settings: a thin wrapper for current settings fetch/update.  

2. **Models**  
   - CalendarEvent type.  
   - Note type.  
   - Settings type.  

3. **Hooks**  
   - `useCalendar()`, `useNotes()`, `useSettings()` that call the API and return `{data, error, isLoading}` or equivalent.  
   - No new behaviour; simply surface existing calls.

4. **Barrel exports**  
   - Each feature’s `index.ts` re-exports its adapter, hook, model, and any component already consumed by the view.  

5. **View rewiring**  
   - CalendarView imports `useCalendar` and `CalendarGrid` from `@features/calendar`.  
   - NotesView imports `useNotes` and `NotesList` from `@features/notes`.  
   - SettingsView imports `useSettings` and `SettingsPanel` from `@features/settings`.

6. **Documentation**  
   - In the PR body:  
     - List of new files per feature.  
     - Before→after import map for each view.

---

## Acceptance Criteria

- [ ] Each feature (`calendar`, `notes`, `settings`) has a non-empty API adapter, model, and hook.  
- [ ] Each feature’s `index.ts` exports these.  
- [ ] Each view imports only from its feature barrel (`@features/<name>`).  
- [ ] No JSX or CSS changes; visuals and behaviour remain identical (ZVD).  
- [ ] PR body includes new file lists and import maps.  

---

## Evidence Ged must attach

- **File lists (sample):**

  ```text
  features/calendar/api/calendarApi.ts
  features/calendar/model/CalendarEvent.ts
  features/calendar/hooks/useCalendar.ts
  features/calendar/index.ts

  features/notes/api/notesApi.ts
  features/notes/model/Note.ts
  features/notes/hooks/useNotes.ts
  features/notes/index.ts

  features/settings/api/settingsApi.ts
  features/settings/model/Settings.ts
  features/settings/hooks/useSettings.ts
  features/settings/index.ts
````

* **Import mapping tables (sample):**

  | View File         | Old Import Path      | New Import Path      |
  | ----------------- | -------------------- | -------------------- |
  | `CalendarView.ts` | `./api/calendarApi`  | `@features/calendar` |
  | `NotesView.ts`    | `./utils/notesFetch` | `@features/notes`    |
  | `SettingsView.ts` | `./api/settingsApi`  | `@features/settings` |

* **Search results:** short paste proving no deep feature imports remain in those views.

---

## Risks & Mitigations

* **Risk:** duplication of types already defined elsewhere.
  *Mitigation:* move canonical types into the feature’s `model/` folder and update references.

* **Risk:** accidental API behaviour change.
  *Mitigation:* define adapters as pass-through wrappers with identical signatures.

* **Risk:** visual regressions creep in.
  *Mitigation:* ZVD check (screenshots + DOM diff) performed on all three views.

---

## Rollback Plan

* Remove the new API/model/hook files.
* Revert barrels back to `export {};`.
* Restore old deep imports in CalendarView, NotesView, SettingsView.
* Confirm build and runtime parity with pre-PR state.

---

## PR Checklist (to include in PR body)

* [ ] Adapters, models, and hooks created for Calendar, Notes, Settings.
* [ ] Feature barrels export them.
* [ ] Views import only from feature barrels.
* [ ] Repo scan proves no deep imports remain in those views.
* [ ] ZVD confirmed (visual/behavioural parity).
* [ ] File lists and import mapping tables included.
* [ ] Rollback plan described.

```
```
