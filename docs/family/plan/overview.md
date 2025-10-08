# Family expansion master plan

This plan defines the full Family-module expansion that will land across PR1 through PR14. It locks the scope, naming, storage shape, UI affordances, logging touchpoints, diagnostics additions, and validation strategy for the entire sequence. Every specification item in this directory is binding until superseded by a future baseline.

## Objectives
- Establish Family as the central, household-scoped record that aggregates rich member profiles, attachments, notes, and renewal tracking.
- Preserve compatibility with the PR0 baseline by keeping all new schema additions optional and additive until explicit backfill work is scheduled.
- Clarify that the existing `name` column remains authoritative until backfill: the new `nickname` field is optional and acts as the preferred display name when present.
- Deliver deterministic UI building blocks: header, banner, grid, drawer, modal, tabs, and orchestration store.
- Introduce observability and diagnostics hooks so support teams can triage issues without direct database inspection.

## Non-goals for this wave
- No background schedulers run in-app or via OS services; reminder storage captures intent only.
- No deep-link routing, push notifications, or cross-module automation.
- No at-rest encryption beyond existing vault behaviour (a future TODO shared in [rollout_checklist.md](rollout_checklist.md)).
- Pronoun capture is deliberately excluded to avoid schema churn; revisit in a later programme.

## Platform assumptions
- macOS is the only supported platform for the PR1–PR14 rollout. Other platforms inherit the PR0 experience until a separate track is planned.

## Workstream overview
- [schema_changes.md](schema_changes.md) defines the authoritative database DDL for PR1 and the expected evolution of baseline SQL snapshots.
- [ipc_extensions.md](ipc_extensions.md) enumerates every new command, payload, and error code introduced through PR2.
- [ui_spec.md](ui_spec.md) documents the renderer architecture, component tree, validation rules, and behavioural contracts for PR4–PR11.
- [logging_policy.md](logging_policy.md) captures how TRACE/DEBUG/INFO/WARN/ERROR events wrap the entire Family flow starting in PR3.
- [attachments.md](attachments.md), [reminders.md](reminders.md), and [notes_linking.md](notes_linking.md) give focused specs for their respective data domains.
- [relationships_future.md](relationships_future.md) records how future household-linked entities will attach to the Family schema without conflicting with the current wave.
- [diagnostics_and_export.md](diagnostics_and_export.md) prescribes the counters, summaries, and redaction TODOs that must accompany PR12.
- [test_strategy.md](test_strategy.md) lists the deterministic coverage plan for backend and renderer code.
- [rollout_checklist.md](rollout_checklist.md) aggregates the acceptance criteria for every PR so release management can tick items without cross-referencing other documents.

## Sequencing summary
1. **PR1** – Schema migration and DDL mirrors.
2. **PR2** – IPC surface extensions and error taxonomy.
3. **PR3** – Logging instrumentation for backend and UI.
4. **PR4** – Renderer store and orchestration glue.
5. **PR5** – Header and banner widgets.
6. **PR6** – Members grid layout.
7. **PR7** – Member drawer with validation tabs.
8. **PR8** – Add member modal flow.
9. **PR9** – Attachments UI integration.
10. **PR10** – Person-scoped notes surface.
11. **PR11** – Renewals UI for reminder intent.
12. **PR12** – Diagnostics and export updates.
13. **PR13** – QA matrix and deterministic seeding.
14. **PR14** – Packaging and beta release deliverables.

Each downstream document references the specific PR in which its requirements become enforceable. No runtime code changes occur as part of PR0.5; the plan alone is the deliverable.
