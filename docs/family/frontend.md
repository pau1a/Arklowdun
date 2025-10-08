# Frontend behaviour

## Mount & layout
`FamilyView` clears the supplied container, inserts a single `<section>`, and keeps all subsequent renders confined to that element. Rendering is performed with `section.innerHTML = …`, so each transition between the list and profile views rebuilds the DOM from scratch.【F:src/FamilyView.ts†L20-L148】

## Listing & creation flow
- `load()` calls `familyRepo.list({ householdId, orderBy: "position, created_at, id" })` and stores the array in the module-level `members` variable; `refresh()` re-runs the same query.【F:src/FamilyView.ts†L27-L39】
- `showList()` draws an unordered list plus the “Add Member” form. `renderMembers` empties the list and appends `<li>` rows with “Open” buttons for each member.【F:src/FamilyView.ts†L41-L85】【F:src/FamilyView.ts†L7-L18】
- The form uses required `<input>` fields and, on submit, parses the `YYYY-MM-DD` date at local noon before calling `familyRepo.create`. After awaiting the create, it refreshes, re-renders the list, and resets the form without additional validation feedback.【F:src/FamilyView.ts†L45-L77】

## Profile editing
- Clicking an “Open” button looks up the member by ID and calls `showProfile(member)`, replacing the section markup with inline birthday and notes controls.【F:src/FamilyView.ts†L79-L145】
- The “Back” button gathers staged edits into a patch, sets `updated_at = nowMs()`, and attempts to persist via `familyRepo.update` before returning to the list. Errors are swallowed by an empty `catch` block.【F:src/FamilyView.ts†L103-L125】
- Notes and birthday fields attach their own `input`/`change` listeners, issuing immediate updates with optimistic UI; failures are ignored silently (`catch {}`) so the view never surfaces error messages to the user.【F:src/FamilyView.ts†L127-L145】

## Event wiring & UX characteristics
- Event listeners are attached per element: the form listens for `submit`, the list delegates `click` events to buttons, and profile controls register their own handlers—there is no shared event bus or global shortcuts in this view.【F:src/FamilyView.ts†L41-L145】
- Because the list is rebuilt with `innerHTML = ""` followed by fresh node creation, there is no diffing or animation; scroll position resets whenever `showList()` reruns after a profile edit.【F:src/FamilyView.ts†L41-L125】
- Date handling uses `toDate(...).toISOString().slice(0,10)` for display and constructs new `Date(y, m-1, d, 12, 0, 0, 0)` instances to store birthdays as epoch milliseconds, matching the integer column in SQLite.【F:src/FamilyView.ts†L62-L144】

## Integration points
- The view obtains the active household via `getHouseholdIdForCalls()` and performs all IPC work through `familyRepo`, with no additional caching or memoisation of the member list beyond the local `members` array.【F:src/FamilyView.ts†L25-L39】【F:src/repos.ts†L32-L107】
- Styling is inherited from the global stylesheet; there are no Family-specific selectors or CSS modules, so the UI relies on default layout styles plus the shared banner configured in the architecture layer.【F:src/styles.scss†L392-L3872】【F:src/layout/Page.ts†L24-L53】
