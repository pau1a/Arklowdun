# Pets Rollout Acceptance Checklist

This checklist tracks verification evidence for each Pets rollout phase. Update the status and link to artefacts (tests, screenshots, diagnostics bundles) once the corresponding PR merges.

## Status Overview

| PR | Focus                                 | Status | Evidence links |
| --- | -------------------------------------- | ------ | -------------- |
| PR1 | Vault ingestion & migration bootstrap | ✅ Complete | [pr1.md](./pr1.md) |
| PR2 | IPC contracts & validation            | ✅ Complete | [pr2.md](./pr2.md) |
| PR3 | Reminder scheduler                    | ✅ Complete | [pr3.md](./pr3.md) |
| PR4 | Virtualised UI shell                  | ✅ Complete | [pr4.md](./pr4.md) |
| PR5 | Detail workflow foundations           | ✅ Complete | [pr5.md](./pr5.md) |
| PR6 | Attachments & thumbnails              | ✅ Complete | [pr6.md](./pr6.md) · [artifacts](../../artifacts/pets/pr6) |
| PR7 | Household sharing                     | ☐ Pending  | [pr7.md](./pr7.md) |
| PR8 | Vault sync                             | ☐ Pending  | [pr8.md](./pr8.md) |
| PR9 | Offline cache hardening               | ☐ Pending  | [pr9.md](./pr9.md) |
| PR10 | Rollout gating & guardrails          | ☐ Pending  | [pr10.md](./pr10.md) |

## PR6 – Attachments & Thumbnails

Mark each item when there is a committed artefact demonstrating the requirement:

- [x] Sanitiser enforced before IPC (unit test + code review link)
- [x] Guard rejections show friendly reason (toast screenshot + log extract)
- [x] Missing attachment flagged inline (UI screenshot of warning state)
- [x] “Fix path” updates row without reload (DOM diff or React profiler capture)
- [x] Thumbnails generated & cached (log excerpts for `thumbnail_built`/`thumbnail_cache_hit`)
- [x] Non-image gracefully falls back (UI screenshot with generic icon)
- [x] Diagnostics counters populated (diagnostics JSON snippet)
- [x] Docs updated (`ui.md`, `diagnostics.md`, `ipc.md`, `plan/checklist.md`, `CHANGELOG.md`)

Update the evidence column in the table above to reference PR numbers or commit hashes once each box is checked. Older PR sections remain for historical traceability even after the rollout completes.
