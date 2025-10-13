# Vehicles Module — Detailed Overview

## 1. Schema Finalisation
- Implement all accepted vehicle attributes in the baseline schema (`migrations/0001_baseline.sql` and `schema.sql`).
- Add `(household_id, reg)` and `(household_id, vin)` unique indices.
- Apply indexes for due-date queries (`next_mot_due`, `next_service_due`).
- Confirm `ON DELETE CASCADE` between vehicles → maintenance.
- Track PR1 execution details in `docs/vehicles/plan/PR1.md` (baseline columns, indices, fixtures, and tests).
**Acceptance:** DB rebuilt cleanly, integrity checks pass, and fixtures seed new fields.

## 2. IPC Surface Upgrade
- Update structs in `src-tauri/src/lib.rs` and Zod contracts under `src/lib/ipc/contracts/index.ts`.
- CRUD helpers use transactions via `sqlx::Transaction`.
- Verify `AppError` propagation and field parity.
- PR1 links: transaction-backed handlers and contract expansion documented in `docs/vehicles/plan/PR1.md`.
**Acceptance:** all IPC handlers tested with full round-trip create/update/delete.

## 3. Repository & State Store
- Extend `src/db/vehiclesRepo.ts` to cache lists and invalidate on mutation.
- Store keys: `vehicles.snapshot`, `vehicles.lastFetch`.
- Add refresh and lazy-load hooks for list and detail.
**Acceptance:** single IPC call per list load, cache invalidated on create/update/delete.

## 4. UI — List View
- Component: `src/ui/vehicles/VehiclesList.ts`.
- Add virtualization threshold (200+ rows).
- Sort and filter by due date, reg, make/model.
- Keyboard: ↑↓ navigate, Enter opens detail, Esc returns.
**Acceptance:** smooth scroll, accessible focus rings, AA contrast verified.

## 5. UI — Detail & Edit
- Component: `src/ui/vehicles/VehicleDetail.tsx`.
- Editable fields: display name, make, model, reg/vin, MOT/service dates.
- Inline validation: required, duplicate reg/vin, date logic.
- Toast feedback for success/error.
**Acceptance:** edits persist instantly without reloading list.

## 6. Maintenance & Attachments
- Sub-component: `src/ui/vehicles/VehicleMaintenance.tsx`.
- Lists service/MOT/insurance docs from `vehicle_maintenance`.
- Actions: add, open, reveal, delete, relink.
- Vault guard handles all filesystem validation.
**Acceptance:** all attachment ops succeed and reflect immediately in UI.

## 7. Diagnostics & Export
- Diagnostics module: `src/diagnostics/collectors/vehiclesCollector.rs`.
- Include counts for `vehicles` and `vehicle_maintenance`.
- Export manifest adds vehicle id and category.
- Orphan scan flags missing attachment files.
**Acceptance:** full export/import cycle restores vehicles without errors.
