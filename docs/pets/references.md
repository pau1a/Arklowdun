# Pets Domain – Cross-References

### Purpose

This document serves as a navigation and interoperability map for the **Pets** domain.
It connects the Pets module to its related subsystems — Family, Vault, Attachments, Search, and Diagnostics — and provides schema anchors, neighbouring IPC references, and a concise glossary of all domain-specific terms.

---

## 1. Related Documentation Links

| Area                    | Path                                       | Description                                                                                                                                                   |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Family**              | `../family/README.md`                      | Describes household member structure; Pets records are scoped to the same `household_id`.                                                                     |
| **Vault & Attachments** | `../architecture/vault-enforcement.md`     | Documents attachment path sanitation, root key limits, and symlink/traversal guards. Pets attachments (categories: `pet_medical`, `pet_image`) follow the same vault policy. |
| **IPC Security**        | `../architecture/ipc-security-playbook.md` | Defines Tauri command safety guidelines; Pets IPC contracts (`pets_*`, `pet_medical_*`) comply with these constraints.                                        |
| **Search Integration**  | `../search.md`                             | Lists Pets as an indexed entity type with the `kind: "Pet"` result format for command-palette queries.                                                        |
| **Diagnostics**         | `../logging/diagnostics.md`                | Outlines how Pets contributes row counts and reminder queue data to diagnostic bundles.                                                                       |
| **Database Integrity**  | `../migrations/authoring.md`               | Reference for writing and verifying Pets-related migrations (0001_baseline.sql, 0023_vault_categories.up.sql).                                                |
| **UI Guidelines**       | `../ui/households/`                        | Contains shared style tokens and banner layout conventions used by the Pets page.                                                                             |
| **Family card grid**    | `../family/ui-grid.md`                     | Documents the responsive card pattern mirrored by the Pets grid, including focus rings and action affordances.                                                |

These linked documents collectively define the policies and conventions that the Pets domain inherits.

---

## 2. Schema References

### 2.1 Core tables

**`pets`**

* Columns: `id`, `household_id`, `name`, `type`, `position`, `image_path`, `created_at`, `updated_at`, `deleted_at`.
* Constraints:

  * `FOREIGN KEY (household_id)` → `households(id)`
  * `CHECK (type IS NOT NULL)`
  * `UNIQUE (household_id, position)`

**`pet_medical`**

* Columns: `id`, `pet_id`, `date`, `description`, `reminder`, `root_key`, `relative_path`, `category`, timestamps.
* Constraints:

  * `FOREIGN KEY (pet_id)` → `pets(id)` ON DELETE CASCADE
  * `CHECK (category='pet_medical')`
  * `UNIQUE (household_id, category, relative_path)`

### 2.2 Shared tables referencing Pets

| Table                     | Column                      | Purpose                                                     |
| ------------------------- | --------------------------- | ----------------------------------------------------------- |
| **`attachments`**         | `category`, `relative_path` | `category='pet_medical'` denotes medical attachments; `category='pet_image'` stores profile photos. |
| **`cascade_checkpoints`** | `table_name`                | Includes `pets` and `pet_medical` in integrity sweep order. |
| **`shadow_read_audit`**   | `entity_kind`               | Logs Pets read access for diagnostics export.               |
| **`schema_migrations`**   | n/a                         | Tracks migrations adding Pets tables and indexes.           |

---

## 3. API Neighbours

The Pets API shares behavioural patterns and sometimes schema conventions with these adjacent domains:

| Domain       | Example IPC Command                            | Relation                                                                     |
| ------------ | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| **Family**   | `family_members_list`, `family_members_update` | Same household scoping and CRUD conventions; Pets is the animal analogue.    |
| **Bills**    | `bills_list_due`, `bills_create`               | Shared ordering by `due_date`, reused validation helpers.                    |
| **Vehicles** | `vehicles_list`, `vehicles_upsert`             | Parallels the maintenance model; both feature attachment + reminder systems. |
| **Property** | `property_docs_list`, `property_docs_attach`   | Shares attachment validation and vault enforcement code paths.               |
| **Search**   | `search_index_pets`, `search_query`            | Pets results appear under `kind: "Pet"` with icon `"fa-paw"`.                |

Each of these neighbours relies on the same IPC scaffolding and repository helpers generated through `gen_domain_cmds!` in `src-tauri/src/lib.rs`.

---

## 4. Integration Behaviour Summary

| Integration     | Shared Mechanism        | Notes                                                                               |
| --------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| **Vault**       | `vault::resolve()`      | Ensures Pets attachments respect vault scope and root-key hygiene.                  |
| **Diagnostics** | `collect_diagnostics()` | Pets adds `pets_total`, `pet_medical_total`, and `reminder_queue_depth`.            |
| **Search**      | `search_index.ts`       | Pets indexed by `name`, `type`, and `medical.description`.                          |
| **Export**      | `export_bundle.rs`      | Pets data redacted identically to Family members (last four characters of IDs).     |
| **Repair**      | `repair_household()`    | Pets cascade deletion and attachment relink executed alongside Family and Vehicles. |

---

## 5. Glossary

| Term                          | Definition                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Pet**                       | A household animal entry tracked under a specific household ID.                                            |
| **Medical Record**            | A dated event (e.g., vaccination, vet visit) associated with a Pet; may include attachments and reminders. |
| **Reminder Scheduler**        | In-app timer subsystem that surfaces notifications for upcoming medical events.                            |
| **Attachment Root Key**       | A symbolic handle (e.g., `appData`) used to derive absolute paths for pet medical attachments.             |
| **Vault**                     | The controlled storage layer enforcing path safety and integrity for on-disk attachments.                  |
| **Reminder Queue Depth**      | Number of active scheduled reminders; reported in diagnostics.                                             |
| **Cascade Checkpoint**        | Integrity sweep stage verifying pets and pet_medical foreign-key consistency.                              |
| **Flexible Request Contract** | IPC payload format allowing either camelCase or snake_case fields; used by Pets and all CRUD domains.      |
| **Crash ID**                  | UUID associated with logged mutation failures for diagnostics traceability.                                |
| **Banner Slot**               | Vertical right-edge image container used across pages, thematically distinct per domain.                   |

---

## 6. Cross-domain comparison matrix

| Domain       | Has Attachments          | Has Reminders          | Has Cascade Deletes         | Has Household Scope | Indexed in Search |
| ------------ | ------------------------ | ---------------------- | --------------------------- | ------------------- | ----------------- |
| **Pets**     | ✅ (`pet_medical`)        | ✅ (scheduler)          | ✅ (`pet_medical` on delete) | ✅                   | ✅                 |
| **Family**   | ✅ (`member_attachments`) | ✅ (birthdays/renewals) | ✅                           | ✅                   | ✅                 |
| **Bills**    | ✅ (invoices)             | ✅ (due date)           | ⚙ partial                   | ✅                   | ✅                 |
| **Vehicles** | ✅ (MOT docs)             | ✅ (service)            | ✅                           | ✅                   | ✅                 |
| **Property** | ✅ (insurance docs)       | ❌                      | ⚙ partial                   | ✅                   | ✅                 |

---

## 7. References & External Standards

* **WCAG 2.1 AA** – Accessibility and contrast compliance, referenced in PR9.
* **SQLite Foreign-Key Constraints** – Enforcement used in `pets` and `pet_medical`.
* **Unicode Normalisation (NFC/NFD)** – Validated during PR10 fixture tests.
* **Tauri v2 Plugin Security Model** – File access limits under `$APPDATA/**`.
* **UUIDv7 Specification (draft-ietf-uuidrev-09)** – Deterministic ID standard adopted for seeded fixtures.

---

## 8. Maintenance Notes

* This reference file should be updated whenever new Pets-related endpoints, schema fields, or diagnostics metrics are introduced.
* Cross-links to Family, Vault, and Diagnostics should remain relative and version-agnostic.
* When new attachments categories are added (e.g., `pet_insurance`), update both the **Schema References** and **API Neighbours** sections.

---

**Status:** Living document — reviewed each beta wave.
**File:** `/docs/pets/references.md`
**Version:** 1.0
**Maintainer:** Documentation team (Ged McSneggle, reviewed by Paula Livingstone)
