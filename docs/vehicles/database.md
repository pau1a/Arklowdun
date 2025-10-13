# Vehicles Database

### Purpose

This note records the current SQLite layout for the Vehicles domain and documents how it aligns with the accepted attribute model agreed for PR1/PR2. It includes every column, index, and integrity rule that ships in `migrations/0001_baseline.sql` / `src-tauri/schema.sql`, then calls out the small divergences that remain in the legacy `schema.sql` snapshot and what clean-up is expected.

---

## 1. Tables

### 1.1 `vehicles`

| Column                               | Type    | Constraints                                                                                  | Notes |
| ------------------------------------ | ------- | --------------------------------------------------------------------------------------------- | ----- |
| `id`                                 | TEXT    | Primary key                                                                                  | UUIDv7 generated on insert.
| `household_id`                       | TEXT    | `NOT NULL`, `REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE`                   | Scopes a vehicle to a single household.
| `name`                               | TEXT    | `NOT NULL`                                                                                   | Display name.
| `reg`                                | TEXT    | Nullable                                                                                     | Uppercase registration number; uniqueness enforced per household.
| `vin`                                | TEXT    | Nullable                                                                                     | 17-character VIN; uniqueness enforced per household.
| `position`                           | INTEGER | `NOT NULL DEFAULT 0`                                                                         | UI ordering slot.
| `make`                               | TEXT    | Nullable                                                                                     | Manufacturer.
| `model`                              | TEXT    | Nullable                                                                                     | Model name.
| `trim`                               | TEXT    | Nullable                                                                                     | Trim level.
| `model_year`                         | INTEGER | Nullable                                                                                     | Four-digit year stored as integer.
| `colour_primary`                     | TEXT    | Nullable                                                                                     | British spelling retained.
| `colour_secondary`                   | TEXT    | Nullable                                                                                     | Secondary body colour.
| `body_type`                          | TEXT    | Nullable                                                                                     | Hatchback, saloon, etc.
| `doors`                              | INTEGER | Nullable                                                                                     | Door count.
| `seats`                              | INTEGER | Nullable                                                                                     | Seating capacity.
| `transmission`                       | TEXT    | Nullable                                                                                     | Manual/automatic descriptor.
| `drivetrain`                         | TEXT    | Nullable                                                                                     | e.g. AWD/FWD/RWD.
| `fuel_type_primary`                  | TEXT    | Nullable                                                                                     | Petrol/diesel/electric.
| `fuel_type_secondary`                | TEXT    | Nullable                                                                                     | Hybrid secondary fuel.
| `engine_cc`                          | INTEGER | Nullable                                                                                     | Cubic centimetre displacement.
| `engine_kw`                          | INTEGER | Nullable                                                                                     | Peak power in kW.
| `emissions_co2_gkm`                  | INTEGER | Nullable                                                                                     | CO₂ grams per kilometre.
| `euro_emissions_standard`            | TEXT    | Nullable                                                                                     | EU standard label.
| `mot_date`                           | INTEGER | Nullable                                                                                     | Legacy MOT timestamp.
| `service_date`                       | INTEGER | Nullable                                                                                     | Legacy service timestamp.
| `mot_reminder`                       | INTEGER | Nullable                                                                                     | Reminder epoch.
| `service_reminder`                   | INTEGER | Nullable                                                                                     | Reminder epoch.
| `mot_last_date`                      | INTEGER | Nullable                                                                                     | Last completed MOT.
| `mot_expiry_date`                    | INTEGER | Nullable                                                                                     | MOT expiry when recorded separately.
| `ved_expiry_date`                    | INTEGER | Nullable                                                                                     | Vehicle Excise Duty expiry.
| `insurance_provider`                 | TEXT    | Nullable                                                                                     | Provider name.
| `insurance_policy_number`            | TEXT    | Nullable                                                                                     | Policy reference.
| `insurance_start_date`               | INTEGER | Nullable                                                                                     | Policy start epoch.
| `insurance_end_date`                 | INTEGER | Nullable                                                                                     | Policy end epoch.
| `breakdown_provider`                 | TEXT    | Nullable                                                                                     | AA, RAC, etc.
| `breakdown_expiry_date`              | INTEGER | Nullable                                                                                     | Breakdown cover expiry.
| `ownership_status`                   | TEXT    | Nullable                                                                                     | Owned, financed, leased.
| `purchase_date`                      | INTEGER | Nullable                                                                                     | Purchase timestamp.
| `purchase_price`                     | INTEGER | Nullable                                                                                     | Stored in pence.
| `seller_name`                        | TEXT    | Nullable                                                                                     | Seller contact.
| `seller_notes`                       | TEXT    | Nullable                                                                                     | Free-form notes.
| `odometer_at_purchase`               | INTEGER | Nullable                                                                                     | Recorded in the configured unit.
| `finance_lender`                     | TEXT    | Nullable                                                                                     | Finance institution.
| `finance_agreement_number`           | TEXT    | Nullable                                                                                     | Agreement reference.
| `finance_monthly_payment`            | INTEGER | Nullable                                                                                     | Pence per month.
| `lease_start_date`                   | INTEGER | Nullable                                                                                     | Lease start.
| `lease_end_date`                     | INTEGER | Nullable                                                                                     | Lease end.
| `contract_mileage_limit`             | INTEGER | Nullable                                                                                     | Mileage cap for lease/PCP.
| `sold_date`                          | INTEGER | Nullable                                                                                     | Disposal date.
| `sold_price`                         | INTEGER | Nullable                                                                                     | Pence realised at sale.
| `odometer_unit`                      | TEXT    | `DEFAULT 'mi'`                                                                               | Either `mi` or `km`.
| `odometer_current`                   | INTEGER | Nullable                                                                                     | Last odometer reading.
| `odometer_updated_at`                | INTEGER | Nullable                                                                                     | Timestamp of latest reading.
| `service_interval_miles`             | INTEGER | Nullable                                                                                     | Manufacturer schedule miles.
| `service_interval_months`            | INTEGER | Nullable                                                                                     | Manufacturer schedule months.
| `last_service_date`                  | INTEGER | Nullable                                                                                     | Last service completion.
| `next_service_due_date`              | INTEGER | Nullable                                                                                     | Planned service date.
| `next_service_due_miles`             | INTEGER | Nullable                                                                                     | Planned service mileage.
| `cambelt_due_date`                   | INTEGER | Nullable                                                                                     | Cambelt schedule.
| `cambelt_due_miles`                  | INTEGER | Nullable                                                                                     | Cambelt mileage schedule.
| `brake_fluid_due_date`               | INTEGER | Nullable                                                                                     | Brake fluid refresh.
| `coolant_due_date`                   | INTEGER | Nullable                                                                                     | Coolant refresh.
| `tyre_size_front`                    | TEXT    | Nullable                                                                                     | Stored as text (e.g. `225/45 R17`).
| `tyre_size_rear`                     | TEXT    | Nullable                                                                                     | Rear size for staggered setups.
| `tyre_pressure_front_psi`            | INTEGER | Nullable                                                                                     | PSI value.
| `tyre_pressure_rear_psi`             | INTEGER | Nullable                                                                                     | PSI value.
| `oil_grade`                          | TEXT    | Nullable                                                                                     | Recommended oil grade.
| `next_mot_due`                       | INTEGER | Nullable                                                                                     | Preferred new field; `list_vehicles` falls back to `mot_date` when `NULL`.
| `next_service_due`                   | INTEGER | Nullable                                                                                     | Falls back to `service_date` when `NULL`.
| `next_ved_due`                       | INTEGER | Nullable                                                                                     | VED renewal.
| `next_insurance_due`                 | INTEGER | Nullable                                                                                     | Insurance renewal.
| `primary_driver_id`                  | TEXT    | Nullable                                                                                     | Links into future driver directory.
| `additional_driver_ids`              | TEXT    | Nullable                                                                                     | JSON array encoded as TEXT.
| `key_count`                          | INTEGER | Nullable                                                                                     | Number of keys on hand.
| `has_spare_key`                      | INTEGER | Nullable                                                                                     | Treated as boolean in IPC contracts.
| `hero_image_path`                    | TEXT    | Nullable                                                                                     | Preferred hero image path (legacy).
| `default_attachment_root_key`        | TEXT    | Nullable                                                                                     | Always forced to `NULL` during IPC writes.
| `default_attachment_folder_relpath`  | TEXT    | Nullable                                                                                     | Suggested vault folder (e.g. `vehicles/veh_123`).
| `status`                             | TEXT    | `DEFAULT 'active'`                                                                          | Active/archived states for future UI.
| `tags`                               | TEXT    | Nullable                                                                                     | JSON array encoded as TEXT.
| `notes`                              | TEXT    | Nullable                                                                                     | Free-form description.
| `created_at`                         | INTEGER | `NOT NULL`                                                                                   | Epoch milliseconds.
| `updated_at`                         | INTEGER | `NOT NULL`                                                                                   | Auto-refreshed on mutate.
| `deleted_at`                         | INTEGER | Nullable                                                                                     | Soft-delete marker.

### 1.2 `vehicle_maintenance`

| Column          | Type    | Constraints                                                                                                    | Notes |
| --------------- | ------- | -------------------------------------------------------------------------------------------------------------- | ----- |
| `id`            | TEXT    | Primary key                                                                                                    | UUIDv7.
| `vehicle_id`    | TEXT    | `NOT NULL`, `REFERENCES vehicles(id) ON DELETE CASCADE ON UPDATE CASCADE`                                     | Cascades with the parent vehicle.
| `date`          | INTEGER | `NOT NULL`                                                                                                    | Millisecond epoch.
| `type`          | TEXT    | `NOT NULL`                                                                                                    | MOT, service, insurance, etc.
| `cost`          | INTEGER | Nullable                                                                                                      | Pence.
| `document`      | TEXT    | Nullable                                                                                                      | Legacy pointer retained for backwards compatibility.
| `household_id`  | TEXT    | `NOT NULL`, `REFERENCES household(id) ON DELETE CASCADE ON UPDATE CASCADE`                                    | Mirrors the parent household.
| `created_at`    | INTEGER | `NOT NULL`                                                                                                    | Insert timestamp.
| `updated_at`    | INTEGER | `NOT NULL`                                                                                                    | Update timestamp.
| `deleted_at`    | INTEGER | Nullable                                                                                                      | Soft-delete marker.
| `root_key`      | TEXT    | Nullable                                                                                                      | Forced to `NULL` by IPC guard; reserved for legacy vault roots.
| `relative_path` | TEXT    | Nullable                                                                                                      | Vault-relative attachment path.
| `category`      | TEXT    | `NOT NULL DEFAULT 'vehicle_maintenance'`, `CHECK (...)`                                                       | Validated against shared attachment taxonomy.

---

## 2. Indexes and constraints

| Name                                          | Definition / Purpose |
| --------------------------------------------- | -------------------- |
| `uq_vehicles_household_reg`                   | Partial unique index on `(household_id, reg)` where `reg IS NOT NULL`; ensures plate uniqueness per household.
| `uq_vehicles_household_vin`                   | Partial unique index on `(household_id, vin)` where `vin IS NOT NULL`; enforces VIN uniqueness.
| `idx_vehicles_due_dates`                      | Multi-column index on `(next_mot_due, next_service_due, ved_expiry_date)` supporting dashboard lookups.
| `idx_vehicles_updated`                        | Household/update timestamp index for sync and diagnostics.
| `vehicles_household_position_idx`             | Partial unique `(household_id, position)` when `deleted_at IS NULL`; keeps ordering gaps closed.
| `vehicle_maintenance_household_updated_idx`   | Tracks `(household_id, updated_at)` for sync.
| `vehicle_maintenance_vehicle_date_idx`        | Sorts maintenance history per vehicle by date.
| `vehicle_maintenance_household_category_path_idx` | Partial unique `(household_id, category, relative_path)` with `deleted_at IS NULL AND relative_path IS NOT NULL`; prevents attachment duplication.

The Rust integration suite in `src-tauri/tests/vehicles_schema.rs` exercises the uniqueness indices by attempting duplicates, ensuring SQLite surfaces `Sqlite/2067` errors with the constraint names in the error context.

---

## 3. Data hygiene guarantees

* **Foreign keys** – Both tables rely on `ON DELETE CASCADE`, which is verified by `household_delete_cascades_vehicle_records`. Dropping a household clears vehicles and their maintenance rows atomically.
* **Soft deletes** – All IPC delete operations write `deleted_at` instead of removing rows, allowing `vehicles_restore`/`vehicle_maintenance_restore` to revive entries. Cascades only trigger on household hard deletes.
* **Attachment guard rail** – `vehicle_maintenance` inherits the shared vault guard enforcement: `root_key` is nulled, categories are clamped to `vehicle_maintenance`, and relative paths are normalised before insert/update.
* **Capability probes** – `db_has_vehicle_columns` checks for the expanded column set so older installs without the migration can disable the Vehicles UI gracefully.

---

## 4. Alignment with the final attribute model

The baseline migration and Rust/TypeScript bindings now expose the full PR1 attribute matrix. The only lingering drift is the generated `/schema.sql` artefact still showing the pre-migration column list; the plan is to refresh that snapshot once downstream tooling no longer depends on it. No further schema changes are required to reach the “final” model described in the plan docs.

---

**Status:** Schema validated by `vehicles_schema.rs` during PR1.

**Scope:** Structural details for `vehicles` and `vehicle_maintenance`, including constraints and enforcement mechanics.

**File:** `/docs/vehicles/database.md`
