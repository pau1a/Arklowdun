# Logging Specification

Status: Draft
Owner: Ged Kelly
Last updated: 2025-10-07

All documentation under `docs/logging/` will use **kebab-case** filenames to remain portable and consistent.

## Audience
Engineering teams implementing the logging surface and integrating the supporting IPC contract.

## Entry and display
* **Entry & display:** Bug icon → Logs view in main content pane; no drawers or modals. The Logs view reuses the primary layout shell so navigation chrome remains stable.

## Data source contract
* **Data source:** Sole source is `diagnostics_summary` IPC. Each call flushes then returns the latest ~200 JSON lines from rotating files. The UI must not read raw files.

## Filtering rules
* **Categories:** Derived from the `event` field in the returned payload. Multi-select with OR semantics; an empty selection means “all categories.”
* **Severity:** Uses an inclusive-upward model (e.g., selecting `warn` includes `warn` and `error`; selecting `info` includes `info`, `warn`, and `error`).

## Time handling
* Store, sort, and filter using the UTC instant contained in each record.
* Display defaults to Europe/London local time.
* Toggling Local↔UTC re-renders timestamps in place without re-fetching data.

## Live tail behaviour
* Live tail is optional and controlled by a toggle.
* When enabled, poll `diagnostics_summary` every 3–5 seconds.
* Leaving the Logs view stops polling immediately.
* Each poll replaces the entire 200-line tail with the latest response; no diffing or incremental merges.

## Rotation and backpressure safety
* Rotation retains five 5 MB JSON files (≈25 MB total). This defines the maximum on-disk footprint for logs.
* The UI never holds file handles.
* The backend writer is non-blocking with a 50k line buffer.
* `diagnostics_summary` responses include `dropped_count` and `log_write_status` (values: `"ok"` or `"io_error"`).
* The UI shows a small banner only when `dropped_count > 0` or `log_write_status` is not `"ok"`.

## Export contract
* **Format:** JSONL only.
* **Structure:**
  1. `_meta` line containing `app_version`, `schema_version`, `os_version`, `exported_at_utc`, and a filter summary.
  2. Raw ~200 lines exactly as returned by `diagnostics_summary`.
  3. `_checksum` line with a SHA-256 computed over the payload lines plus the `record_count`.
* **Filename pattern:** `arklowdun-tail_{appver}_{YYYY-MM-DDTHH-mm-ssZ}_sev-{level}_cats-{comma-list}.jsonl`.

## Cleanup expectations
Leaving the Logs view clears timers, local state, and any transient UI indicators to ensure no leaks persist after navigation.

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

## Acceptance checklist
* Loading the Logs view retrieves ~200 lines through `diagnostics_summary` with no UI file access.
* Applying category filters updates instantly using OR semantics.
* Severity selections follow the inclusive-upward model and apply immediately.
* Local↔UTC toggle re-renders timestamps without re-fetching data.
* Live Tail polling runs every 3–5 seconds and stops when navigating away.
* Banner appears only when `dropped_count > 0` or `log_write_status` differs from `"ok"`.
* Exported file contains `_meta`, payload, and `_checksum` lines in that order with a valid SHA-256 checksum.

## Design rationale
* **200-line tail:** chosen to keep payload <1 MB and guarantee IPC safety margin.
* **3–5 s polling:** balances freshness and CPU/network overhead; derived from tracing buffer flush cadence.
* **UTC storage:** avoids DST ambiguity; Europe/London chosen for local display as the only supported zone.
* **Inclusive-upward severity:** matches `tracing_subscriber` level filtering semantics.
* **No diffing:** full-tail replacement ensures determinism under rotation.
