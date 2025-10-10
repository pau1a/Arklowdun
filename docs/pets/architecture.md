# Pets Architecture

Owner: Ged McSneggle
Status: Current as of `schema.sql` and migrations through `0027_family_expansion`
Scope: Structural overview of the Pets domain (lists, medical records, reminders, attachments)

## Purpose
Pets records capture the household-scoped identity for each animal, while associated medical entries track reminders and vault-backed documents so they can be exported and audited alongside the wider household dataset.【F:schema.sql†L210-L234】【F:docs/domain-models.md†L128-L147】【F:src-tauri/src/export/mod.rs†L380-L418】

## Context within the wider system
- **Household integration.** Both `pets` and `pet_medical` rows require a `household_id` and cascade on household deletion, keeping every operation constrained to the active household context.【F:schema.sql†L210-L234】
- **Vault attachments.** Medical records store `category = 'pet_medical'` and `relative_path` values, which the backend interprets through the shared attachment categories to resolve vault paths safely.【F:schema.sql†L220-L234】【F:src-tauri/src/attachment_category.rs†L46-L104】
- **Reminder workflow.** Reminder timestamps live on the `pet_medical` row and are scheduled client-side through the notification permission pipeline so pets reuse the same toast infrastructure as other reminder features.【F:schema.sql†L220-L234】【F:src/PetsView.ts†L29-L52】
- **Shared infrastructure.** Pets use the generic repository factory and search cache invalidation, participate in diagnostics household counts, and contribute attachment data to exports just like other ordered domains.【F:src/repos.ts†L27-L103】【F:src-tauri/src/diagnostics.rs†L101-L118】【F:src-tauri/src/export/mod.rs†L380-L418】

## Responsibilities
| Area | Responsibility |
| --- | --- |
| Data persistence | Maintain household-scoped `pets` rows plus `pet_medical` history with ordering metadata and cascades.【F:schema.sql†L210-L234】 |
| Ordering | Default list ordering follows `position, created_at, id` both in the UI requests and backend enforcement.【F:src/PetsView.ts†L61-L73】【F:src-tauri/src/repo.rs†L157-L209】 |
| Reminders | Schedule future notifications and catch-up alerts whenever medical records expose a `reminder` timestamp.【F:src/PetsView.ts†L29-L52】 |
| Attachments | Sanitize relative paths before IPC calls, invoke vault-backed open/reveal handlers, and rely on backend guards for canonicalisation.【F:src/PetDetailView.ts†L69-L152】【F:src/files/sanitize.ts†L1-L14】【F:src/ui/attachments.ts†L11-L31】【F:src-tauri/src/vault/mod.rs†L46-L128】 |
| Diagnostics & export | Surface pets and medical counts in diagnostics summaries and include pet medical attachments when generating export bundles.【F:src-tauri/src/diagnostics.rs†L101-L118】【F:src-tauri/src/export/mod.rs†L380-L418】 |

## Module layout
| Layer | Location | Notes |
| --- | --- | --- |
| Database schema | `schema.sql` | Defines `pets`/`pet_medical` tables, cascades, reminder column, and attachment fields with indexes for ordering and reminder lookups.【F:schema.sql†L210-L352】 |
| Migrations | `migrations/0001_baseline.sql`, `migrations/0023_vault_categories.up.sql` | Baseline migration creates both tables; migration 0023 adds the attachment category column and uniqueness constraint over household/category/path.【F:migrations/0001_baseline.sql†L165-L189】【F:migrations/0023_vault_categories.up.sql†L5-L52】 |
| IPC wiring | `src-tauri/src/lib.rs` | `gen_domain_cmds!` registers `pets_*` and `pet_medical_*` commands for the Rust backend dispatcher.【F:src-tauri/src/lib.rs†L4427-L4438】 |
| Command helpers | `src-tauri/src/commands.rs`, `src-tauri/src/repo.rs` | Shared CRUD helpers enforce household scope, allowed ordering, timestamp stamping, and attachment guards for each command.【F:src-tauri/src/commands.rs†L670-L736】【F:src-tauri/src/repo.rs†L157-L209】【F:src-tauri/src/commands.rs†L707-L735】 |
| Front-end repos | `src/repos.ts` | `petsRepo` and `petMedicalRepo` call the IPC layer with default ordering and clear search caches after writes.【F:src/repos.ts†L27-L103】 |
| Views | `src/PetsView.ts`, `src/PetDetailView.ts`, `src/ui/views/petsView.ts` | The list view mounts via `wrapLegacyView`, renders markup, schedules reminders, and launches the detail view; the detail view performs CRUD on medical rows and attachments before handing back to the list.【F:src/PetsView.ts†L54-L130】【F:src/PetDetailView.ts†L11-L156】【F:src/ui/views/petsView.ts†L1-L4】【F:src/ui/views/wrapLegacyView.ts†L5-L19】 |
| Contracts | `src/lib/ipc/contracts/index.ts` | Exposes the flexible Pets and Pet Medical IPC contracts used by the repository layer.【F:src/lib/ipc/contracts/index.ts†L676-L687】 |
| Tests & fixtures | `src-tauri/tests/baseline.rs`, `src-tauri/tests/file_ops.rs`, `src-tauri/tests/fixtures/sample.sql` | Baseline tests seed the Pets category, attachment repair tests exercise pet medical rows, and sample fixtures include the schema for local seeding.【F:src-tauri/tests/baseline.rs†L36-L49】【F:src-tauri/tests/file_ops.rs†L133-L149】【F:src-tauri/tests/fixtures/sample.sql†L167-L328】 |

## Data flow
1. **UI interaction.** The list view loads the active household, fetches pets ordered by position, and renders inline markup; form submissions create new pets and reschedule reminders.【F:src/PetsView.ts†L59-L105】
2. **Repository calls.** `petsRepo`/`petMedicalRepo` pass household-scoped payloads to the IPC command names generated from the table, inheriting default ordering and cache invalidation.【F:src/repos.ts†L39-L103】
3. **IPC contracts.** Calls route through the flexible Pets command definitions so the renderer and backend agree on payload shapes without bespoke Zod schemas for this domain.【F:src/lib/ipc/contracts/index.ts†L676-L687】
4. **Command execution.** Rust helpers validate household scope, enforce allowed orderings, stamp timestamps, and prepare attachment mutations before executing SQL via `repo::*`.【F:src-tauri/src/commands.rs†L670-L736】【F:src-tauri/src/repo.rs†L157-L209】
5. **Persistence.** SQL executes against the shared SQLite database where cascades and unique indexes guarantee ordering and attachment invariants.【F:schema.sql†L210-L352】
6. **Renderer updates.** Successful responses update the in-memory list, trigger reminder scheduling, and, on detail view changes, refresh the cached pets plus reschedule notifications.【F:src/PetsView.ts†L66-L124】【F:src/PetDetailView.ts†L133-L149】
7. **Diagnostics & export.** Background tooling counts pets and pet medical rows for diagnostics and emits attachment manifests that include the `pet_medical` category, ensuring exports stay in sync.【F:src-tauri/src/diagnostics.rs†L101-L118】【F:src-tauri/src/export/mod.rs†L380-L418】

## Security and isolation
- **Attachment path hygiene.** The renderer trims and sanitizes relative paths before sending them over IPC, preventing traversal or empty segments up front.【F:src/PetDetailView.ts†L128-L142】【F:src/files/sanitize.ts†L1-L14】
- **Vault enforcement.** Backend vault guards normalise, length-check, and symlink-check resolved paths, enforcing category and household restrictions with consistent error codes.【F:src-tauri/src/vault/mod.rs†L46-L128】
- **UI error surfacing.** Attachment open/reveal commands translate vault errors into user-facing toasts so path issues do not fail silently.【F:src/ui/attachments.ts†L11-L31】
- **Reminder permission checks.** Notifications only schedule after requesting permission, avoiding attempts to deliver reminders without OS consent.【F:src/PetsView.ts†L29-L34】

## Cross-domain dependencies
| Depends on | Used for |
| --- | --- |
| Household store | Resolves the active household ID before any repo call or detail view render.【F:src/PetsView.ts†L59-L64】【F:src/PetDetailView.ts†L17-L25】【F:src/db/household.ts†L1-L20】 |
| Search cache | Clearing caches after mutations keeps Pets entries discoverable in command palette/search results.【F:src/repos.ts†L49-L73】 |
| Diagnostics | Household diagnostics counts include pets and pet medical stats for support investigations.【F:src-tauri/src/diagnostics.rs†L101-L118】 |
| Exports | Attachment manifest generation enumerates the `pet_medical` category when building export bundles.【F:src-tauri/src/export/mod.rs†L380-L418】 |

## Known constraints
- Reminder timers rely on recursive `setTimeout` without storing handles, so they cannot be cancelled when the view unmounts or the household changes mid-session.【F:src/PetsView.ts†L8-L14】【F:src/ui/views/wrapLegacyView.ts†L5-L19】
- Medical record descriptions render directly into `innerHTML`, so any sanitisation must happen before data entry; the view itself does not escape user-provided strings.【F:src/PetDetailView.ts†L28-L63】
- The list and form markup are rebuilt from template strings with no dedicated stylesheet imports, so Pets currently inherits base UI styling rather than bespoke SCSS tokens.【F:src/PetsView.ts†L75-L103】
- `pet_medical` schema still carries legacy `document` columns alongside vault metadata, requiring downstream tooling to ignore or migrate the unused field.【F:schema.sql†L220-L234】【F:migrations/0001_baseline.sql†L176-L189】

