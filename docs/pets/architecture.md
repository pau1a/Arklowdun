# Pets Architecture

Owner: Ged McSneggle
Status: Current as of `schema.sql` and migrations through `0027_family_expansion`
Scope: Structural overview of the Pets domain (lists, medical records, reminders, attachments)

## Purpose
Pets records capture the household-scoped identity for each animal, while associated medical entries track reminders and vault-backed documents so they can be exported and audited alongside the wider household dataset.【F:schema.sql†L210-L234】【F:docs/domain-models.md†L128-L147】【F:src-tauri/src/export/mod.rs†L380-L418】

## Context within the wider system
- **Household integration.** Both `pets` and `pet_medical` rows require a `household_id` and cascade on household deletion, keeping every operation constrained to the active household context.【F:schema.sql†L210-L234】
- **Vault attachments.** Medical records store `category = 'pet_medical'` and `relative_path` values, which the backend interprets through the shared attachment categories to resolve vault paths safely.【F:schema.sql†L220-L234】【F:src-tauri/src/attachment_category.rs†L46-L104】
- **Reminder workflow.** Reminder timestamps live on the `pet_medical` row and are scheduled client-side through the dedicated reminder scheduler so pets reuse the same toast infrastructure as other reminder features.【F:schema.sql†L220-L234】【F:src/features/pets/reminderScheduler.ts†L123-L303】【F:src/PetsView.ts†L90-L160】
- **Shared infrastructure.** Pets use typed repositories that enforce IPC contracts, clear the search cache after mutations, participate in diagnostics household counts, and contribute attachment data to exports just like other ordered domains.【F:src/repos.ts†L33-L141】【F:src-tauri/src/diagnostics.rs†L101-L118】【F:src-tauri/src/export/mod.rs†L380-L418】

## Responsibilities
| Area | Responsibility |
| --- | --- |
| Data persistence | Maintain household-scoped `pets` rows plus `pet_medical` history with ordering metadata and cascades.【F:schema.sql†L210-L234】 |
| Ordering | Default list ordering follows `position, created_at, id` both in the UI requests and backend enforcement.【F:src/PetsView.ts†L62-L88】【F:src-tauri/src/repo.rs†L157-L209】 |
| Reminders | Schedule future notifications and catch-up alerts whenever medical records expose a `reminder` timestamp.【F:src/features/pets/reminderScheduler.ts†L123-L303】【F:src/PetsView.ts†L90-L160】 |
| Attachments | Sanitize relative paths before IPC calls, invoke vault-backed open/reveal handlers, and rely on backend guards for canonicalisation.【F:src/ui/pets/PetDetailView.ts†L331-L378】【F:src/ui/pets/PetDetailView.ts†L451-L466】【F:src/files/path.ts†L1-L102】【F:src/ui/attachments.ts†L11-L31】【F:src-tauri/src/vault/mod.rs†L46-L128】 |
| Diagnostics & export | Surface pets and medical counts in diagnostics summaries and include pet medical attachments when generating export bundles.【F:src-tauri/src/diagnostics.rs†L101-L118】【F:src-tauri/src/export/mod.rs†L380-L418】 |

## Module layout
| Layer | Location | Notes |
| --- | --- | --- |
| Database schema | `schema.sql` | Defines `pets`/`pet_medical` tables, cascades, reminder column, and attachment fields with indexes for ordering and reminder lookups.【F:schema.sql†L210-L352】 |
| Migrations | `migrations/0001_baseline.sql`, `migrations/0023_vault_categories.up.sql` | Baseline migration creates both tables; migration 0023 adds the attachment category column and uniqueness constraint over household/category/path.【F:migrations/0001_baseline.sql†L165-L189】【F:migrations/0023_vault_categories.up.sql†L5-L52】 |
| IPC wiring | `src-tauri/src/lib.rs` | `gen_domain_cmds!` registers `pets_*` and `pet_medical_*` commands for the Rust backend dispatcher.【F:src-tauri/src/lib.rs†L4427-L4438】 |
| Command helpers | `src-tauri/src/commands.rs`, `src-tauri/src/repo.rs` | Shared CRUD helpers enforce household scope, allowed ordering, timestamp stamping, and attachment guards for each command.【F:src-tauri/src/commands.rs†L670-L736】【F:src-tauri/src/repo.rs†L157-L209】【F:src-tauri/src/commands.rs†L707-L735】 |
| Front-end repos | `src/repos.ts` | `petsRepo` and `petMedicalRepo` coerce payloads through typed schemas, apply default ordering, and clear search caches after writes.【F:src/repos.ts†L33-L141】 |
| Views | `src/PetsView.ts`, `src/features/pets/PetsPage.ts`, `src/ui/pets/PetDetailView.ts`, `src/ui/views/petsView.ts` | `PetsView` mounts the persistent shell, wires virtualised list callbacks, schedules reminders, and launches the detail host; `PetsPage` owns DOM structure and windowed rendering; the detail view performs CRUD on medical rows and attachments before handing back to the list.【F:src/PetsView.ts†L57-L180】【F:src/features/pets/PetsPage.ts†L1-L619】【F:src/ui/pets/PetDetailView.ts†L124-L516】【F:src/ui/views/petsView.ts†L1-L4】【F:src/ui/views/wrapLegacyView.ts†L5-L19】 |
| Contracts | `src/lib/ipc/contracts/pets.ts` | Defines the Pets and Pet Medical IPC schemas shared by renderer and backend.【F:src/lib/ipc/contracts/pets.ts†L1-L167】 |
| Tests & fixtures | `src-tauri/tests/baseline.rs`, `src-tauri/tests/file_ops.rs`, `src-tauri/tests/fixtures/sample.sql` | Baseline tests seed the Pets category, attachment repair tests exercise pet medical rows, and sample fixtures include the schema for local seeding.【F:src-tauri/tests/baseline.rs†L36-L49】【F:src-tauri/tests/file_ops.rs†L133-L149】【F:src-tauri/tests/fixtures/sample.sql†L167-L328】 |

## Data flow
1. **UI interaction.** `PetsView` loads the active household, fetches ordered pets, and hydrates the persistent shell; inline create/edit routes through callbacks that mutate the cache and reschedule reminders.【F:src/PetsView.ts†L57-L180】
2. **Repository calls.** `petsRepo`/`petMedicalRepo` validate payloads with typed schemas, add household scoping, and dispatch to the generated IPC commands while clearing the search cache on mutations.【F:src/repos.ts†L33-L141】
3. **IPC contracts.** Calls route through the dedicated Pets command definitions so the renderer and backend share identical Zod schemas for requests and responses.【F:src/lib/ipc/contracts/pets.ts†L1-L167】
4. **Command execution.** Rust helpers validate household scope, enforce allowed orderings, stamp timestamps, and prepare attachment mutations before executing SQL via `repo::*`.【F:src-tauri/src/commands.rs†L670-L736】【F:src-tauri/src/repo.rs†L157-L209】
5. **Persistence.** SQL executes against the shared SQLite database where cascades and unique indexes guarantee ordering and attachment invariants.【F:schema.sql†L210-L352】
6. **Renderer updates.** Successful responses update the in-memory list, trigger reminder scheduling, and, on detail view changes, refresh the cached pets plus reschedule notifications while keeping the shell mounted.【F:src/PetsView.ts†L90-L178】【F:src/ui/pets/PetDetailView.ts†L459-L511】
7. **Diagnostics & export.** Background tooling counts pets and pet medical rows for diagnostics and emits attachment manifests that include the `pet_medical` category, ensuring exports stay in sync.【F:src-tauri/src/diagnostics.rs†L101-L118】【F:src-tauri/src/export/mod.rs†L380-L418】

## Security and isolation
- **Attachment path hygiene.** The renderer trims and sanitizes relative paths before sending them over IPC, preventing traversal or empty segments up front.【F:src/ui/pets/PetDetailView.ts†L451-L466】【F:src/files/path.ts†L1-L102】
- **Vault enforcement.** Backend vault guards normalise, length-check, and symlink-check resolved paths, enforcing category and household restrictions with consistent error codes.【F:src-tauri/src/vault/mod.rs†L46-L128】
- **UI error surfacing.** Attachment open/reveal commands translate vault errors into user-facing toasts so path issues do not fail silently.【F:src/ui/attachments.ts†L11-L31】
- **Reminder permission checks.** Notifications only schedule after requesting permission, avoiding attempts to deliver reminders without OS consent.【F:src/features/pets/reminderScheduler.ts†L123-L158】【F:src/features/pets/reminderScheduler.ts†L293-L306】

## Cross-domain dependencies
| Depends on | Used for |
| --- | --- |
| Household store | Resolves the active household ID before any repo call or detail view render.【F:src/PetsView.ts†L59-L64】【F:src/ui/pets/PetDetailView.ts†L124-L137】【F:src/db/household.ts†L1-L20】 |
| Search cache | Clearing caches after mutations keeps Pets entries discoverable in command palette/search results.【F:src/repos.ts†L84-L114】 |
| Diagnostics | Household diagnostics counts include pets and pet medical stats for support investigations.【F:src-tauri/src/diagnostics.rs†L101-L118】 |
| Exports | Attachment manifest generation enumerates the `pet_medical` category when building export bundles.【F:src-tauri/src/export/mod.rs†L380-L418】 |

## Known constraints
- Reminder timers rely on recursive `setTimeout` without storing handles, so they cannot be cancelled when the view unmounts or the household changes mid-session.【F:src/features/pets/reminderScheduler.ts†L123-L210】【F:src/ui/views/wrapLegacyView.ts†L5-L19】
- Medical record descriptions render via `textContent`, so user input is not interpreted as HTML even when it includes markup-like characters.【F:src/ui/pets/PetDetailView.ts†L329-L332】
- Virtualisation assumes a fixed row height (`56px`). Editing layouts must stay within that height or update the constant and styles in tandem.【F:src/features/pets/PetsPage.ts†L40-L60】【F:src/styles/_pets.scss†L1-L92】
- `pet_medical` schema still carries legacy `document` columns alongside vault metadata, requiring downstream tooling to ignore or migrate the unused field.【F:schema.sql†L220-L234】【F:migrations/0001_baseline.sql†L176-L189】

