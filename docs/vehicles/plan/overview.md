# Vehicles Delivery Plan

This roadmap outlines the seven blocks required to take Vehicles from the current read-only prototype to the finished product. Each block produces a concrete artefact and leans on the foundations already described in the other documents.

---

## 1. Schema Finalisation

Lock down the database contract by reconciling `migrations/0001_baseline.sql`, `src-tauri/schema.sql`, and the generated `schema.sql`. This block ensures every accepted attribute (trim, finance, due dates, attachment defaults) is represented with matching constraints and indices, with fixtures and tests updated accordingly. The outcome is a migration set that can be applied without further alterations.

## 2. IPC Surface Upgrade

Expand the Rust commands and TypeScript Zod contracts so every column travels cleanly across IPC, including validation for registration and VIN fields plus attachment guard coverage. This block also introduces typed error paths (e.g. duplicate VIN) and ensures integration tests exercise create/update/delete round trips.

## 3. Repo / Store

Replace the ad-hoc `vehiclesRepo` calls with a proper repository and store layer: cached list/detail responses, invalidation on mutation, and React-style hooks for consumers. Doing so paves the way for richer UI states without hammering the IPC bridge.

## 4. List View

Rebuild the Vehicles list as a production-ready component with virtualisation, sorting, filtering, overdue highlighting, and keyboard navigation. The deliverable is a responsive list that can handle hundreds of vehicles without jank while still honouring accessibility requirements.

## 5. Detail & Edit

Transform the detail pane into a full editor: form fields for all mutable attributes, inline validation, optimistic updates, toast feedback, and safe destructive flows. This block retires the legacy DOM view in favour of a componentised React/Preact surface.

## 6. Maintenance & Attachments

Expose vehicle maintenance history alongside attachment management (add/open/reveal/delete). The work covers UI components, IPC wiring for maintenance CRUD, attachment guard UX, and vault diagnostics so users can manage MOT documents and receipts without leaving the app.

## 7. Diagnostics & Export

Augment diagnostics to include Vehicles-specific health checks, orphan scans, and anonymised counts; update the export pipeline to dump vehicle and maintenance tables plus their attachments. The outcome is a supportable domain where backups/restores preserve the entire fleet.

---

**Note:** Dashboard widgets and cross-domain automation remain out of scope for this plan; they will be handled after the Vehicles core feature ships.
