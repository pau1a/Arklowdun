# Logging Overview

Status: Draft
Owner: Ged Kelly
Last updated: 2025-10-07

All documentation under `docs/logging/` will use **kebab-case** filenames to remain portable and consistent.

## Audience
Paula, testers, and product management stakeholders who need to understand how the in-app logging experience behaves during the beta phase.

## What the Logs view is
The Logs view is reached by selecting the bug icon located in the footer at the bottom-right of the application. Activating the icon routes the main content pane into the logging experience while leaving the existing sidebar and footer elements visible. Within that pane, users can inspect the most recent diagnostics tail without navigating away from the rest of the interface.

## Why logging exists
The logging experience underpins beta stability work, accelerates troubleshooting during testing, and gives support teams the context they need for handoffs. By standardising how logs are viewed and exported inside the application, we reduce the latency between identifying an issue, gathering evidence, and sharing it with engineering.

## High-level capabilities
* Optional live tail that refreshes the visible log list without reloading the page.
* Category filters derived from the `event` field and severity filters that respect inclusive-upward ordering.
* Time display toggle that switches between Europe/London local time and UTC, re-rendering rows immediately.
* Export action that produces a JSONL tail for downstream analysis or attachment to tickets.

## Scope and current limits
* Available on macOS only during the beta period.
* Each diagnostics pull returns roughly the most recent 200 log lines; older history requires external tooling.
* No redaction pipeline is in place, so sensitive data that reaches logs remains visible.
* Session identifiers and request correlation identifiers are not present unless explicitly added in later iterations.

## How to access and use it
1. Click the bug icon in the footer (bottom-right) to load the Logs view in the main content pane.
2. Use severity and category filters to narrow the list. Filters apply client-side to the ~200 line tail.
3. Toggle between Local and UTC timestamps to match the context of the investigation.
4. Enable Live Tail to poll in the background while remaining on the Logs view; disable it or navigate away to stop polling.
5. Use the Export button to download the current tail as JSONL for archival or sharing.

## PR plan summary
* **PR-0 — Docs groundwork (this PR).** Establish the documentation suite that defines the logging experience and link it from the primary docs index.
* **PR-1 — Entry & Display.** Implement the bug icon route to render the Logs view within the main content pane while preserving sidebar and footer.
* **PR-2 — Data Source.** Request the diagnostics tail through `diagnostics_summary`, maintaining a 200-line in-memory buffer and avoiding direct file reads.
* **PR-3 — Viewing & Filtering.** Render the core table, category multi-select, and free-text search working entirely on the client.
* **PR-4 — Time Handling.** Standardise on UTC storage while offering an instantaneous Local↔UTC display toggle defaulting to Europe/London.
* **PR-5 — Live Tail.** Add the polling loop (3–5 s) that keeps the tail fresh only while the Logs view is active.
* **PR-6 — Backpressure & Rotation Safety.** Surface drop counters and writer status via the IPC contract and display a banner solely when data loss or errors are reported.
* **PR-7 — Export (JSONL).** Deliver the structured JSONL export with metadata, payload, checksum, deterministic naming, and completion toast.
* **PR-8 — Cleanup & QA.** Final polish to ensure timers, state, and QA checklist compliance before exiting beta scope.

## PR sequence (PR-0 → PR-8)
* **PR-0 — Docs groundwork (this PR).**
  Create `docs/logging/` with OVERVIEW, SPEC, UI, IPC, EXPORT. Link from `docs/README.md`.

* **PR-1 — Entry & Display.**
  Wire bug icon to route into Logs view in the main content pane. Sidebar/footer unchanged. No drawers/modals.

* **PR-2 — Data Source.**
  Call `diagnostics_summary` on load; hold returned tail (~200 lines) in memory. No file reads from UI.

* **PR-3 — Viewing & Filtering.**
  Render table (timestamp, level, event, message). Add category multi-select (OR). Add free-text search. All client-side.

* **PR-4 — Time Handling.**
  Sort/filter on UTC epoch; display Local (Europe/London) by default. Add Local↔UTC toggle with instant re-render.

* **PR-5 — Live Tail.**
  Add Live Tail toggle; poll `diagnostics_summary` every 3–5 s while view is active; stop on exit.

* **PR-6 — Backpressure & Rotation Safety.**
  Extend IPC to include `dropped_count` + `log_write_status`; show banner only when needed. No persistent handles.

* **PR-7 — Export (JSONL).**
  Export tail with `_meta` line, raw payload lines, `_checksum` line; deterministic filename; toast with SHA-256.

* **PR-8 — Cleanup & QA.**
  Ensure all timers/state cleared on route change; UX polish; acceptance checklist pass on macOS.

Each PR references the relevant section(s) of `SPEC.md` and updates them **only if** behaviour changes. Otherwise, no doc edits.

## Related documents
* [SPEC](./SPEC.md)
* [UI](./UI.md)
* [IPC](./IPC.md)
* [EXPORT](./EXPORT.md)

## Acceptance checklist (PR-0)
- All five Markdown files present with header blocks and cross-links.
- Relative links verified in GitHub viewer.
- docs/README.md updated and functional.
- SPEC includes rationale and rotation details.
- IPC ordering clarified.
- UI severity colours defined.

Status changes to *Stable* once PR-8 merges and all logging acceptance criteria have passed.
