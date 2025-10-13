# Vehicles UI

### Purpose

Describe the presentational layer for Vehicles: what renders today, how state flows into the DOM, and the gaps left for later roadmap blocks.

---

## 1. Layout

`VehiclesView` (`src/VehiclesView.ts`) mounts into the legacy view harness via `wrapLegacyView`. On load it:

1. Resolves the active household ID via `getHouseholdIdForCalls`.
2. Creates a `<section>` container and injects `<ul id="veh-list"></ul>`.
3. Calls `vehiclesRepo.list(household)` and renders each vehicle as:
   ```html
   <li>
     <span class="veh-name">{name}</span>
     <span class="badge">MOT: {fmt(next_mot_due)}</span>
     <span class="badge">Service: {fmt(next_service_due)}</span>
     <button data-id="{id}">Open</button>
   </li>
   ```

When `vehiclesRepo.list` returns an empty array, the code lazily imports `ui/EmptyState`, renders the copy from `STR.empty.vehiclesTitle/vehiclesDesc`, and appends that inside the `<ul>`.

A delegated `click` handler on the list captures button presses, looks up the vehicle via `vehiclesRepo.get`, and swaps the section contents with `VehicleDetailView`.

The detail view (`src/VehicleDetail.ts`) is purely read-only today:

```html
<button id="back">Back</button>
<h2>{name}</h2>
<p>Make: {make}</p>
<p>Model: {model}</p>
<p>Reg: {reg}</p>
<p>VIN: {vin}</p>
<p>MOT: {fmt(next_mot_due)}</p>
<p>Service: {fmt(next_service_due)}</p>
<div>
  <button id="edit">Edit</button>
  <button id="delete">Delete</button>
</div>
```

Only the “Back” button is wired; “Edit” and “Delete” are placeholders for future roadmap work. There is no routing change—`VehicleDetailView` simply reuses the `section` element and calls back into `renderList` once “Back” fires.

---

## 2. Toasts, empty states, and focus

- **Toasts** – All IPC failures bubble through the shared `showError` helper (`src/ui/errors.ts`), which normalises the `AppError` and calls `toast.show({ kind: "error", message })`. Vehicles does not customise the copy.
- **Empty state** – Implemented via `createEmptyState` with strings sourced from `STR.empty`; no bespoke illustration or CTA exists yet.
- **Focus** – The view makes no explicit focus assignments beyond the default browser behaviour. `wrapLegacyView` clears DOM nodes on unmount but does not restore focus, so keyboard users land on the top of the container after transitions.

---

## 3. Styling

There is no Vehicles-specific stylesheet; list markup relies on whatever global styles target `.badge`, list items, and buttons. Any future componentisation will need to introduce scoped CSS or reuse the design system utilities documented in `docs/ui/`.

---

## 4. Known gaps

- No create/edit forms or inline save flows.
- No pagination, filtering, or virtualisation—large fleets will render every row in the DOM.
- Detail pane lacks maintenance history, attachments, and destructive action wiring.
- Keyboard navigation relies on browser defaults; there is no explicit focus ring management.

---

**Status:** Legacy DOM view, read-only as of PR2.

**Scope:** Rendering behaviour only (business logic captured elsewhere).

**File:** `/docs/vehicles/ui.md`
