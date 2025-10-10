# Pets Domain – Plan & Rollout Overview

### Purpose

This document defines the **rollout framework, sequencing, and acceptance conditions** for the Pets feature within the Arklowdun app.
It tracks how Pets progresses through the PR sequence toward closed-beta readiness and aligns its functional milestones with the existing Family and Attachments programmes.

---

## 1. Position in the overall programme

| Context                | Description                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| **Domain**             | Pets — management of companion animals, medical records, and reminders. |
| **Parent stream**      | Household record expansion following Family (PR1–PR14 baseline).        |
| **Scope**              | Local CRUD, reminders, and attachments for pet-specific medical data.   |
| **Platform target**    | macOS (DMG beta build only).                                            |
| **Sync model**         | Offline-first; no network replication or cloud sync.                    |
| **Dependency domains** | Vault, Attachments, Diagnostics, and Household scoping.                 |

The Pets stream begins after the Family rollout stabilises at PR14 and is tracked as a **post-Family sub-programme**, structured identically with numbered PRs (PR0–PR10).

---

## 2. Rollout sequencing

| Phase  | Description                                      | Deliverable                                                  |
| ------ | ------------------------------------------------ | ------------------------------------------------------------ |
| PR0    | Documentation baseline and repo preparation.     | `/docs/pets/` folder with full reference suite (A–H blocks). |
| PR1    | Schema confirmation and migration test coverage. | Verified `pets` and `pet_medical` schema parity with baseline. |
| PR2    | IPC endpoint validation and typed contracts.     | Confirm working `pets_*` and `pet_medical_*` calls.          |
| PR3    | Repo-layer isolation and error taxonomy.         | Stable `petsRepo` + `petMedicalRepo` integration tests.      |
| PR4    | UI shell and list/detail wiring.                 | Functional PetsView + PetDetailView.                         |
| PR5    | Reminder scheduling and runtime logging.         | Working notification loop with diagnostic traces.            |
| PR6    | Attachment handling and vault guard verification. | Create/open/reveal working under `pet_medical`.             |
| PR7    | Empty-state and deletion UX.                     | Graceful no-data visuals and confirmation flow.              |
| PR8    | Diagnostics counters and export integration.     | Pets metrics visible in support bundles.                     |
| PR9    | Accessibility and keyboard QA.                   | ARIA compliance and focus review.                            |
| PR10   | Tests & fixtures hardening for beta release.       | Deterministic seeds, cross-arch CI, full Pets E2E coverage.  |

Each PR will include a per-PR checklist file in `docs/pets/plan/`, mirroring the Family rollout format.

---

## 3. Acceptance criteria for beta inclusion

To qualify for inclusion in the **closed-beta build**, the Pets feature must satisfy all of the following:

1. **Schema and integrity**

   * No integrity errors from `PRAGMA foreign_key_check` or `integrity_check`.
   * `pet_medical` cascades verified by automated tests.
   * All default values (timestamps, categories) correctly materialise in SQL dumps.

2. **Functional**

   * Pet list and detail views fully operable (create, edit, delete, view).
   * Reminder scheduling triggers under macOS Notification Center.
   * Attachment open/reveal calls validated via Vault guard.
   * Household scoping respected on all CRUD operations.

3. **Diagnostics**

   * Counters (`pets_total`, `pet_medical_total`, `pet_reminders_total`) emitted in diagnostic exports.
   * No missing redaction paths for pets data in collectors.
   * Logs contain structured JSON entries for key lifecycle events.

4. **UX parity**

   * Follows base theme tokens (spacing, typography, palette).
   * Banner image visible and route-aware on right-edge panel.
   * Empty-state message displayed when no pets exist.

5. **Documentation**

   * `/docs/pets/` structure complete and linked from `/docs/README.md`.
   * Each document (A–H) includes status line and owner attribution.
   * PR-specific checklist file appended for every milestone merge.

6. **Release audit**

   * macOS DMG passes smoke tests: open, list, add, delete, notify.
   * Diagnostics bundle includes Pets section with counts > 0.
   * No unhandled promise rejections or unsanitised innerHTML warnings.

---

## 4. Roadmap alignment

The Pets rollout inherits all **Family-era operational disciplines**:

* **Deterministic seeding:** seed scripts (`tools/seed/seed_pets.ts`) must generate identical UUIDv7 sequences per run.
* **Test hygiene:** all tests deterministic; no `#[ignore]` or randomness.
* **Release sequencing:** PR numbers map one-to-one with acceptance docs in `docs/pets/plan/`.

The domain’s introduction is scoped as a **functional expansion**, not a stylistic one — meaning no new rendering frameworks, storage engines, or plugin dependencies are introduced.

Parallel rollouts (Bills, Property, Vehicles) may share UI components but not schema.

---

## 5. Future-work placeholders

All future-looking elements are explicitly deferred and must not be pre-implemented:

| Placeholder                 | Description                                | Earliest PR |
| --------------------------- | ------------------------------------------ | ----------- |
| **Pet Photos**              | Image thumbnails or avatars.               | PR11+       |
| **Health Tracking**         | Weight/vaccine analytics charts.           | PR11+       |
| **Microchip Registry Sync** | Integration with external API.             | Out of scope |
| **Multi-household sharing** | Pets linked across households.             | Out of scope |
| **Reminder Snooze/Dismiss** | User interaction with fired notifications. | PR11+       |

These placeholders exist purely for traceability and future planning, not current beta scope.

---

## 6. Change history (snapshot)

| PR     | Date (planned) | Summary                                               |
| ------ | -------------- | ----------------------------------------------------- |
| PR0    | Oct 2025       | Documentation foundation created under `/docs/pets/`. |
| PR1    | TBD            | Schema & integrity validation completed.              |
| PR2    | TBD            | IPC contracts validated with Zod typing.              |
| PR3    | TBD            | Repositories refactored and tested.                   |
| PR4    | TBD            | PetsView + PetDetailView functional UI delivered.     |
| PR5    | TBD            | Reminder scheduling operational.                      |
| PR6    | TBD            | Vault/attachment paths enforced.                      |
| PR7    | TBD            | Empty-state + delete confirmations added.             |
| PR8    | TBD            | Diagnostics counters integrated.                      |
| PR9    | TBD            | Accessibility audit complete.                         |
| PR10   | TBD            | Tests & fixtures hardened; Intel + ARM CI matrix green. |

All PR checklists are to be created incrementally under `/docs/pets/plan/`.

---

## 7. Sign-off & ownership

| Role                  | Name              | Responsibility                                 |
| --------------------- | ----------------- | ---------------------------------------------- |
| **Domain Owner**      | Ged McSneggle     | Technical implementation & rollout execution.  |
| **Programme Lead**    | Paula Livingstone | Oversight, beta gate, and integration QA.      |
| **Documentation**     | Shared            | Updates to `/docs/pets/` following each merge. |
| **QA & Verification** | Internal          | Validation of schema integrity, UI, and logs.  |

---

**Status:** Active planning phase (pre-PR0).
**Scope:** Defines roadmap, acceptance conditions, sequencing, and placeholders for the Pets rollout programme.
**File:** `/docs/pets/plan/overview.md`

---
